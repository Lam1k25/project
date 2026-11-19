const express = require('express');
const http = require('http');
const { spawn } = require('node:child_process');

const app = express();
const PORT = process.env.PORT || 3001;
const URL = `http://127.0.0.1:${PORT}/messenger.html`;

app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.redirect('/messenger.html');
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server is running on http://127.0.0.1:${PORT}`);
  if (process.env.BROWSER === 'none') {
    return;
  }

  console.log(`Opening ${URL}`);
  const browserCommand = process.platform === 'win32'
    ? 'rundll32.exe'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const browserArgs = process.platform === 'win32'
    ? ['url.dll,FileProtocolHandler', URL]
    : [URL];
  const browser = spawn(browserCommand, browserArgs, {
    detached: true,
    stdio: 'ignore',
  });

  browser.on('error', (error) => {
    console.error(`Could not open the browser: ${error.message}`);
  });
  browser.unref();
});