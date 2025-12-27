const fs = require('fs');
try {
    const content = fs.readFileSync('renderer.js', 'utf8');
    new Function(content);
    console.log('Syntax OK');
} catch (e) {
    console.log('Syntax Error:', e.message);
}
