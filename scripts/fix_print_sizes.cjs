const fs = require('fs');
const p = 'src/utils/imageUtils.js';
let s = fs.readFileSync(p, 'utf8');

const correctSizes = `export const PRINT_SIZES = {
  'ID Card (CR80)': { cssWidth: '85.6mm', cssHeight: '54mm', width: 1010, height: 638, isID: true },
  '4x6 Photo': { cssWidth: '152.4mm', cssHeight: '101.6mm', width: 1800, height: 1200, is4x6: true },
  'A4': { cssWidth: '210mm', cssHeight: '297mm', width: 2480, height: 3508, isFullPage: true },
  'Passport (2x2)': { cssWidth: '51mm', cssHeight: '51mm', width: 602, height: 602, isPassport: true },
  'Stamp (20x25)': { cssWidth: '20mm', cssHeight: '25mm', width: 236, height: 295, isStamp: true },
  'Stamp (25x30)': { cssWidth: '25mm', cssHeight: '30mm', width: 295, height: 354, isStamp: true },
};`;

s = s.replace(/export const PRINT_SIZES = \{[\s\S]*?\};/, correctSizes);
fs.writeFileSync(p, s);
console.log('✅ Replaced PRINT_SIZES with correct stamp sizes (20×25 mm and 25×30 mm)');
