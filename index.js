var fs = require('fs');
var path = require('path');
const os = require('os');
var readline = require('readline');
var {google} = require('googleapis');
var OAuth2 = google.auth.OAuth2;
const electron = require('electron');
const { app, BrowserWindow, Tray, Menu } = require('electron');
const ytdl = require('ytdl-core');
var ffmpeg = require('fluent-ffmpeg');

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const adapter = new FileSync('db.json');
const db = low(adapter);

var SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
var TOKEN_DIR = (process.env.USERPROFILE || process.env.HOME || process.env.HOMEPATH) + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'youtube-downloader.json';

let windows = [];

if (db.has('save_dir').value() == false) {
    let p = (os.homedir() + '/Documents');
    db.set('save_dir', p).write();
    console.log(p);
}

fs.readFile('client_secret.json', function processClientSecrets(err, content) {
  if (err) {
    console.log('Error loading client secret file: ' + err);
    return;
  }
  authorize(JSON.parse(content), (auth) => {
      markAllPreviousLikedVideos(auth);
      setInterval(() => {
        queryLikedVideos(auth);
      }, 2000);
  });
});
function authorize(credentials, callback) {
  var clientSecret = credentials.installed.client_secret;
  var clientId = credentials.installed.client_id;
  var redirectUrl = credentials.installed.redirect_uris[0];
  var oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);

  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      getNewToken(oauth2Client, (auth) => {
        const dialogOptions = {
            type: 'info', buttons: ['OK', 'Cancel'],
            message: 'Do it?'};
        electron.dialog.showMessageBox(dialogOptions, (idx) => {
            if (idx == 0) {
                callback(auth);
            }
            else {
                markAllPreviousLikedVideos(auth, undefined, () => {
                    callback(auth);
                });
            }
        });
      });      
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client);
    }
  });
}

function showAuthWindow(authUrl, callback) {
    var authWindow = new BrowserWindow({
        width: 800, 
        height: 600, 
        show: false, 
        'node-integration': false,
        'web-security': false
    });
    
    authWindow.loadURL(authUrl);
    authWindow.show();
    authWindow.webContents.on('will-navigate', function (event, newUrl) {
        console.log(newUrl);
        if (newUrl.includes('oauth2/approval/')){
            let code = newUrl.split('approvalCode=')[1];
            callback(code);
            authWindow.close();
        }
    });
    
    authWindow.on('closed', function() {
        authWindow = null;
    });
}
function getNewToken(oauth2Client, callback) {
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ', authUrl);
  showAuthWindow(authUrl, (code) => {
      
      code = code.replace('%2F', '/');
      console.log(code);

    oauth2Client.getToken(code, function(err, token) {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
}
function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
    if (err) throw err;
    console.log('Token stored to ' + TOKEN_PATH);
  });
  console.log('Token stored to ' + TOKEN_PATH);
}

function downloadAndConvert(win, data) {
    let savePath = db.get('save_dir').value();
    ytdl('http://www.youtube.com/watch?v=' + data.id)
        .pipe(fs.createWriteStream(`${data.id}.flv`))
        .on('close', () => {
            ffmpeg(`${data.id}.flv`)
            .toFormat('mp3')
            .save(`${savePath}/${data.id}.mp3`)
            .on('codecData', function(data) {
                console.log(data.duration);
            })
            .on('progress', (p) => {
                console.log(p);
                win.webContents.send('progress', p.percent);
            })
            .on('end', () => {
                win.webContents.send('done', {});
                setTimeout(() => {
                    let safeTitle = data.snippet.title
                        .replace('\\', '_')
                        .replace('/', '_');
                    fs.unlink(`${data.id}.flv`);
                    fs.rename(`${savePath}/${data.id}.mp3`, `${savePath}/${safeTitle}.mp3`);
                }, 150);
            });
        })
}

function markAllPreviousLikedVideos(auth, pageToken) {
    var service = google.youtube('v3');
    service.videos.list({
      auth: auth,
      part: 'snippet',
      myRating: 'like',
      pageToken: pageToken,
      maxResults: 20,
    }, function(err, response) {
      if (err) {
        console.log('The API returned an error: ' + err);
        return;
      }

      for (let item of response.data.items) {
        db.set(item.id, 1).write();
      }

      if (response.data.nextPageToken == undefined)
        return;
      markAllPreviousLikedVideos(auth, response.data.nextPageToken);
    });
}
function queryLikedVideos(auth) {
    var service = google.youtube('v3');
    service.videos.list({
      auth: auth,
      part: 'snippet',
      myRating: 'like'
    }, function(err, response) {
      if (err) {
        console.log('The API returned an error: ' + err);
        return;
      }

      for (let item of response.data.items) {
          let has = db.has(item.id).value();

          if (has == false) {
            db.set(item.id, 1).write();
            let win = createWindow(item);
            downloadAndConvert(win, item);
          }
      }
    });
  }


function showPathDialog() {
    electron.dialog.showOpenDialog(null, {
        properties: ['openDirectory'],
    },
    (path) => {
        console.log(path);
        db.set('save_dir', path).write();
    });
}

function layoutWindows() {
    const {width, height} = electron.screen.getPrimaryDisplay().workAreaSize;

    let i = 0;
    for (let window of windows) {
        window.setPosition(
            width - 410,
            height - 110 - i * 105,
            false);
        i ++;
    }
}
function createWindow(data) {
   const {width, height} = electron.screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    x: width - 410, y: height - 110,
    width: 400, height: 100,
    transparent: true,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: true
  });
  win.loadURL('file:///index.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('init', data);
  });
  win.on('closed', () => {
    windows = windows.filter(x => x != win);
    layoutWindows();
  });
  windows.push(win);
  layoutWindows();

  return win;
}

app.on('ready', () => {
    const tray = new Tray('assets/youtube.ico');
    const contextMenu = Menu.buildFromTemplate([
      {label: 'Select Music Directory', click: () => {
          showPathDialog();
      }},
      {label: 'Quit', click: () => {
          app.quit();
      }}
    ])
    tray.setToolTip('YoutubeDownloader')
    tray.setContextMenu(contextMenu);
});
app.on('window-all-closed', (e) =>{
    
});