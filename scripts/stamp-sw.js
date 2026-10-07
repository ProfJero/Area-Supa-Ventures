// Gives the service worker a new version on every build so installed apps
// pick up the new files.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'Area Supa Ventres', 'sw.js');
const version = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const src = fs.readFileSync(file, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
fs.writeFileSync(file, src);
console.log('sw.js version', version);
