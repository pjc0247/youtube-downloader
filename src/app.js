const remote = require('electron').remote;
var ipcRenderer = require('electron').ipcRenderer;

ipcRenderer.on('init', (event, data) => {
    console.log(data);
    document.getElementById("title")
        .innerHTML = data.snippet.title;
    document.getElementById("thumb")
        .src = data.snippet.thumbnails.default.url;
});
ipcRenderer.on('progress', (event, percent) => {
    document.getElementById("progress")
        .innerHTML = percent;
});
ipcRenderer.on('done', (event, data) => {
    remote.getCurrentWindow().close();
});