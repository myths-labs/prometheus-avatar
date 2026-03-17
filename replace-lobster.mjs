import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
    });
}

function processFolder(folder) {
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.md'];
    if (!fs.existsSync(folder)) return;

    walkDir(folder, function (filePath) {
        if (!exts.includes(path.extname(filePath))) return;

        // Skip node_modules and .next
        if (filePath.includes('node_modules') || filePath.includes('.next')) return;

        let content = fs.readFileSync(filePath, 'utf8');
        let newContent = content
            .replace(/lobster/g, 'openclaw')
            .replace(/Lobster/g, 'OpenClaw')
            .replace(/LOBSTER/g, 'OPENCLAW');

        if (content !== newContent) {
            fs.writeFileSync(filePath, newContent);
            console.log('Updated:', filePath);
        }
    });
}

processFolder('marketplace-app/src');
processFolder('apps/demo/src');

// Rename the api/verify/lobster folder
const lobsterFolder = 'marketplace-app/src/app/api/verify/lobster';
const openclawFolder = 'marketplace-app/src/app/api/verify/openclaw';

if (fs.existsSync(lobsterFolder)) {
    console.log('Renaming', lobsterFolder, 'to', openclawFolder);
    fs.renameSync(lobsterFolder, openclawFolder);
}
