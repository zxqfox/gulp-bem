var fs = require('fs');
var path = require('path');

//var gulp = require('gulp');
//var clone = require('gulp-clone');

var through = require('through2');
var sort = require('sort-stream2')

var walk = require('bem-walk');
var bemDeps = require('@bem/deps');
var toArray = require('stream-to-array');
var vfs = require('vinyl-fs');
var File = require('vinyl');

var bemjsonToBemEntity = require('./bemjson2bemdecl');
var bemdeclToBemEntity = require('./bemdecl2bemEntity');

//var DUMP = through.obj(function(file, enc, cb) {
//    debugger;
//    //console.log(file);
//    cb(null, file);
//});

function BEMProject(opts) {
    this.levelsConfig = opts.bemconfig || {};
    var levels = Object.keys(this.levelsConfig);
    this.levels = levels;

    this.introspection = walk(levels, {levels: this.levelsConfig})
        .pipe(sort(function(a, b) {
            return levels.indexOf(a.level) -
                levels.indexOf(b.level);
        }));
}

BEMProject.prototype.bundle = function (opts) {
    opts || (opts = {});

    // TODO: Levels of bundle are subset of project levels 

    opts.levels || (opts.levels = this.levels);
    opts.project = this;

    return new BEMBundle(opts);
};

/**
 * map bem-deps by bem-walk-entities
 * @param  {Array} decl        – bem-deps [{ block, elem, modName, modVal }, ...]
 * @param  {Array} fsEntities  – bem-walk [{ entity: { block, elem, modName, modVal }, tech }, ...]
 * @param  {String[]} tech     - tech name: 'js' || 'css' || 'bemhtml' || ...
 * @param  {Function} cb       - callback with filtred decls with files
 */
function filterDeps(decl, fsEntities, extensions, cb) {
    var entitiesWithTech = [];

    decl.forEach(function(entity) {
        var ewt = fsEntities.filter(function(file) {
            if(extensions.indexOf('.' + file.tech) === -1) return;
            if(file.entity.block !== entity.block) return;
            if(file.entity.elem !== entity.elem) return;
            if(file.entity.modName !== entity.modName) return;
            // True modifiers are truly outrageous.
            if(file.entity.modVal === true && !entity.hasOwnProperty('modVal')) return true;
            if(entity.modVal === true && !file.entity.hasOwnProperty('modVal')) return true;

            if(file.entity.modVal !== entity.modVal) return;
            return true;
        });

        entitiesWithTech = [].concat(entitiesWithTech, ewt);
    });

    cb(null, entitiesWithTech);
}

/**
 * BEMBundle
 * @param {Object} opts
 * @param {?String} opts.name
 * @param {String} opts.path
 * @param {String} opts.decl
 * @param {String[]} opts.levels
 * @param {Promise<FileEntity[]>} opts.introspection
 */
function BEMBundle(opts) {
    opts = opts || {};

    // todo: make it asserts
    if (!opts.path) throw new Error('Bundle requires `path` property');
    if (!opts.decl) throw new Error('Bundle requires `decl` property with bemjson.js or bemdecl.js file');
    if (!opts.levels || !Array.isArray(opts.levels)) throw new Error('`levels` property should be an array');

    this._name = opts.name || path.basename(opts.path);
    this._path = opts.path;
    this._decl = path.resolve(opts.path, opts.decl);
    this._levels = opts.levels;
    this._project = opts.project;

    debugger;
    var declStream = vfs.src(this._decl);

    if (this._decl.endsWith('.bemjson.js')) {
        this._entities  = declStream.pipe(bemjsonToBemEntity());
    } else {
        this._entities  = declStream.pipe(bemdeclToBemEntity());
    }

    //TODO: take it from introspect
    this._deps = bemDeps.load({levels: this._levels});
}

BEMBundle.prototype.entities = function() {
    return this._entities
};

BEMBundle.prototype.src = function(opts) {
    if (!opts.tech) throw new Error('Prokin` tech');

    var bundle = this;
    var extensions = opts.extensions || [opts.tech];
    opts = Object.assign({}, {levels: this._levels}, opts);

    var entities = toArray(this._entities);
    var deps = toArray(this._deps);
    var introspection = toArray(this._project.introspection);

    var stream = through.obj();

    Promise.all([
      entities,
      deps,
      introspection
    ])
    .then(function(res) {
        debugger;
        var deps = bemDeps.resolve(res[0], res[1]);

        filterDeps(deps.entities, res[2], extensions, function(err, sourceFiles) {
            if (err) {
                stream.emit('error', err)
                return stream.push(null);
            }

            sourceFiles
                .forEach(function(p) {
                    var file = new File({path: p.path});
                    // file.contents = fs.createReadStream(p.path);
                    file.contents = fs.readFileSync(p.path);
                    stream.push(file);
                });

            stream.push(null);
        });
    })
    .catch(function(err) {
        stream.emit('error', err)
        stream.push(null);
    });

    return stream;
};

BEMBundle.prototype.commentWrapper = function() {
    var bundlePath = this._path;
    return through.obj(function(file, enc, cb) {
        var filePath = path.relative(bundlePath, file.path);
        var commentsBegin = '/* ' + filePath + ': begin */ /**/\n';
        var commentsEnd = '\n/* ' + filePath + ': end */ /**/\n';
        file.contents = Buffer.concat([new Buffer(commentsBegin),
                file.contents,
                new Buffer(commentsEnd)])
        cb(null, file);
    });
}

BEMBundle.prototype.name = function () {
    return this._name;
};

module.exports = function (opts) {
    return new BEMProject(opts);
};
