//config
process.env.DEBUG = 'metalsmith:destination metalsmith';
const devBuild = ((process.env.NODE_ENV || '').trim().toLowerCase() !== 'production'),
      debug = devBuild ? require('gulp-debug') : null,
//      debug = devBuild ? require('metalsmith-debug') : null;
      config = require('../../configuration/config');
      metadata = require(config.dir.config+'/metadata');

const
//gulp-metalsmith setup
      gulp = require('gulp'),
      del = require('del'),
      fs = require('fs'),
      gulpsmith = require('gulpsmith'),
      gulp_front_matter = require('gulp-front-matter'),
      assign = require('lodash.assign');


const
//metalsmith-plugins
      assets             = require('metalsmith-assets'),
      collections        = require('metalsmith-collections'),
      discoverHelpers    = require('metalsmith-discover-helpers'),
      discoverPartials   = require('metalsmith-discover-partials'),
      drafts             = require('metalsmith-drafts'),
      excerpts           = require('metalsmith-excerpts'),
      gravatar           = require('metalsmith-gravatar'),
      inPlace            = require('metalsmith-in-place'),
      inspect            = require('metalsmith-inspect'),
      layouts            = require('metalsmith-layouts'),
      lunr               = require('metalsmith-lunr'),
      markdownRemarkable = require('metalsmith-markdown-remarkable'),
      paginate           = require('metalsmith-paginate'),
      permalinks         = require('metalsmith-permalinks'),
      prism              = require('metalsmith-prism'),
      remarkableEmoji    = require('remarkable-emoji'),
      remarkableMentions = require('remarkable-mentions'),
      striptags          = require('striptags'),
      {TfIdf}            = require('natural'),
//gulp-plugins
      sass = require('gulp-sass');


gulp.task('default', ['watch']);

gulp.task('clean', function () {
  del(config.dir.dest+'/**');
});

gulp.task('watch', function () {
  gulp.watch(config.dir.src+'/**', ['metalsmith-json']);
});


gulp.task('build', ['sass'], function () {
  return gulp
  .src([config.dir.src+'/process/**/*', '!'+config.dir.src+'/process/assets/stylesheets/**/*.scss'])
//    .pipe(debug({title: 'metalsmith:'}))
    .pipe(gulp_front_matter()).on("data", function(file) {
        assign(file, file.frontMatter);
        delete file.frontMatter;
    })
    .pipe(
        gulpsmith(config.dir.base)
        .metadata(metadata)
        .use(inspect({
              disable: true,
              includeMetalsmith: true,
              exclude: ['contents',  'excerpt', 'stats', 'next', 'previous'],
            }))
        .use(drafts())
        .use(collections({
            posts: {
              sortBy: 'date',
              reverse: true,
            }
          }))
        .use(relations({
            max: 3,
            match: {
              collection: 'posts',
            }
          }))
        .use(markdownRemarkable('full', {
            html: true,
            linkify: true,
            typographer: true,
          })
          .use(remarkableEmoji)
          .use(remarkableMentions())
        )
        .use(prism({
            lineNumbers: true,
          }))
        .use(excerpts())
        .use(gravatar({
            owner: "you@email.com",
          }))
        .use(permalinks({
            pattern: ':title',
            linksets: [
              {
                match: { collection: 'posts' },
                pattern: ':date/:title',
              },
            ],
          }))
        .use(paginate({
            path: 'page',
          }))
        .use(discoverHelpers({
            directory: config.dir.src+'/helpers'
          }))
        .use(discoverPartials({
            directory: config.dir.src+'/partials'
          }))
        .use(inPlace())
        .use(layouts({
            engine: 'handlebars',
            default: 'page.html',
            directory: config.dir.src+'/layouts',
          }))
        .use(lunr({
            ref: 'path',
            indexPath: 'search/index.json',
            fields: {
              title: 5,
              contents: 1,
              tags: 10,
            },
            preprocess: striptags
          }))
        .use(assets({
            source: config.dir.src+'/assets',
            destination: 'assets',
          }))
    )
    .pipe(gulp.dest(config.dir.dest));
});

function preparePages(entries) {
  return entries.items.reduce(function (acc, item) {
    acc[item.fields.slug.replace(/\.html$/, '.md')] = {
      title: item.fields.title,
      order: item.fields.order,
      layout: 'basic.swig',
      contents: item.fields.content
    };
    return acc;
  }, {});
}

gulp.task('sass', function() {
  return gulp.src(config.dir.src+'/process/assets/stylesheets/**/*.scss')
  .pipe(sass({
    outputStyle: 'expanded',
  }).on('error', sass.logError))
  .pipe(gulp.dest(config.dir.dest+'/assets/stylesheets/'));
});

gulp.task('sass:watch', function() {
  gulp.watch('sass/**/*.scss', ['sass']);
});

function relations(options) {
  options = Object.assign({
    terms: 5,
    max: 5,
    threshold: 0,
    text: document => String(document.contents)
  }, options);

  if(options.match == null) {
    throw new Error("Expected match criteria on which to filter.");
  }

  function matchDocument(file) {
    const {match} = options;

    return Object.keys(match).every(key => {
      if(file[key] === match[key]) { return true }
      if(file[key] && file[key].indexOf) {
        return file[key].indexOf(match[key]) > -1;
      }

      return false;
    });
  }

  return (files, metalsmith, done) => {
    const tfidf = new TfIdf();
    const keys = Object.keys(files).filter(key => matchDocument(files[key]));

    keys.forEach(key => tfidf.addDocument(options.text(files[key]), key));

    keys.forEach((key, index) => {
      const document = files[key];
      const keyTerms = tfidf.listTerms(index)
      .slice(0, options.terms)
      .map(({term}) => term);

      document.relations = keys.reduce((relations, key, d) => {
        if(d !== index) {
          const frequency = tfidf.tfidf(keyTerms, d);

          if(frequency > options.threshold) {
            relations.push({key, frequency});
          }
        }

        return relations;
      }, [])
      .sort((a, b) => a.frequency - b.frequency)
      .slice(0, options.max)
      .map(({key}) => files[key]);
    });

    done();
  };
}