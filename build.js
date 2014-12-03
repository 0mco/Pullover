var fs = require('fs');
var swig  = require('swig');
var async = require('async');
var program = require('commander');
var Promise = require('promise');
var archiver = require('archiver');
var NwBuilder = require('node-webkit-builder');
var Connection = require('ssh2');
var packageInfo = require('./src/package');

var buildConf = require('./buildConf');

// Console app
// build
program
  .version(packageInfo.version)
  .command('build')
  .description('Build binaries')
  .action(build);
// upload
program
  .command('upload')
  .description('Upload to Sourceforge')
  .action(function() {
    deployToSourceforge(buildConf.deployDir, packageInfo.version)
    .then(function(files) {
        console.log('UPLOAD DONE');
        console.log('Updating README.md');
        updateReadme(files);
    });
  });
program
    .command('updateReadme')
    .description('Updates readme')
    .action(function() {
        var files = [
            "Pullover_0.1.2_linux32.zip",
            "Pullover_0.1.2_linux64.zip",
            "Pullover_0.1.2_osx.zip",
            "Pullover_0.1.2_win.zip"
        ];
        updateReadme(files);
    });

program.parse(process.argv);


/**
 * Bundle App with node-webkit for different platforms
 * @return {promise}
 */
function build() {
    var nw = new NwBuilder(buildConf.nwbuild);

    // Log stuff you want
    nw.on('log',  console.log);

    // Build returns a promise
    return nw.build().then(function () {
        console.log('All done!');
        var deploymentPath = buildConf.deployDir;
        var version = packageInfo.version;
        // Zip files for deployment to sourceforge
        if(! fs.existsSync(deploymentPath)){
            fs.mkdirSync(deploymentPath);
        }
        console.log('Start zipping ...');
        for(i = 0; i < nwOptions.platforms.length; i++) {
            // These will all run in parallel, make sure every
            // zip process has it's own JS scope
            (function() {
                var platform = nwOptions.platforms[i];
                var path = './bin/pullover/' + platform;
                var zipName = 'Pullover_' + version + '_' + platform + '.zip';

                var zipPath = deploymentPath + '/' + zipName;
                if(fs.existsSync(zipPath)){
                    console.log(zipPath + ' already existed. Deleting it.');
                    fs.unlinkSync(zipPath);
                }
                var output = fs.createWriteStream(zipPath);
                var archive = archiver('zip');
                output.on('close', function () {
                    console.log(zipName + ' done. ' + Math.floor(archive.pointer() / 1024 / 1024) + ' MB');
                });
                archive.on('error', function(err){
                    throw err;
                });
                archive.pipe(output);
                archive.bulk([
                    { expand: true, cwd: path, src: ['**'], dest: '.'}
                ]);
                archive.finalize();
            })();
        }
    }).catch(function (error) {
        console.log('BUILD PROCESS FAILED');
        console.error(error);
    });
}




/**
 * Upload files in localDir to remote dir
 * deployToSourceforge('./bin/deployZip', '0.x.x', options);
 *
 * @param  {string} localDir  './some/Dir'
 * @param  {string} remoteDir 'dirName' only first level supported
 * @param  {object} options   Connection info
 * @return {promise}
 */
function deployToSourceforge(localDir, remoteDir) {
    var conn = new Connection();
    var files;
    return new Promise(function(resolve, reject) {
        remoteDir = '/home/pfs/p/'+buildConf.sourceforge.project+'/' + remoteDir;
        conn.on('ready', function() {
            console.log('Connection :: ready');
            // Init SFTP
            conn.sftp(function(err, sftp) {
                if (err) console.log(err);
                // Create dir and ignore error (dir already exists)
                sftp.mkdir(remoteDir, function(err) {
                    if (err) console.log('Dir already exists', err);
                    else console.log('Dir created');
                    // Upload files
                    files = fs.readdirSync(localDir);
                    async.eachSeries(files, function(file, callback) {
                        console.log('Uploading file: ', localDir + '/' + file);
                        sftp.fastPut(localDir + '/' + file, remoteDir + '/' + file, callback);
                    }, function(err) {
                        if (err) console.log('Upload error:', err);
                        console.log('Upload done');
                        sftp.end();
                        resolve(files);
                    });
                });
            });
        }).connect(buildConf.sourceforge);
    }).then(function(result) {
        conn.end();
        return result;
    });
}

function updateReadme(files) {
    if(files === undefined || files.length === 0) return;
    var downloads = [];
    // URLs: https://sourceforge.net/projects/pullover/files/0.1.2/Pullover_0.1.2_win.zip/download
    //       https://sourceforge.net/projects/[PROJECT]/files/[VERSION]/[FILENAME]/download
    var baseURL = "https://sourceforge.net/projects/" +
                    buildConf.sourceforge.project +
                    "/files/" +
                    packageInfo.version + '/';

    function getPlatformName(file) {
        if(/_win/.test(file)) return "Windows";
        else if (/_osx/.test(file)) return "Mac OS 10.8+";
        else if (/_linux32/.test(file)) return "Linux x32";
        else if (/_linux64/.test(file)) return "Linux x64";
        else return "Unkown";
    }

    // Build downloads array
    for(i = 0; i < files.length; i++) {
        var file = files[i];
        var download = {
            fileName: file,
            url: baseURL + file + '/download',
            platformName: getPlatformName(file)
        };
        downloads.push(download);
    }

    // Template
    var template = swig.compileFile('./res/README.md.tpl');
    var templateVars = {
        downloads: downloads.reverse(),
        version: packageInfo.version
    };
    // Write new readme
    fs.writeFile('./README.md', template(templateVars), function(err) {
        if(err) console.log(err);
    });
}
