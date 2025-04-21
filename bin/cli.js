#!/usr/bin/env node

const psd2json = require('../index.js');
const path = require('path');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: psd2json <psd-file-path> [output-directory] [--flatten] [--max-width=<width>] [--max-height=<height>]');
  process.exit(0);
}

const psdPath = path.resolve(args[0]);
const outputPath = args[1] ? path.resolve(args[1]) : undefined;
const flatten = args.includes('--flatten');

// Parse resolution parameters
const maxWidth = args.find(arg => arg.startsWith('--max-width='));
const maxHeight = args.find(arg => arg.startsWith('--max-height='));

const maxResolution = {};
if (maxWidth) {
  maxResolution.width = parseInt(maxWidth.split('=')[1], 10);
}
if (maxHeight) {
  maxResolution.height = parseInt(maxHeight.split('=')[1], 10);
}

const options = outputPath ? {
  outJsonDir: outputPath,
  outImgDir: outputPath,
  flattenImagePath: flatten,
  maxResolution: Object.keys(maxResolution).length > 0 ? maxResolution : null
} : undefined;

// 使用异步版本的psd2json
psd2json.async(psdPath, options)
  .then(result => {
    if (!outputPath) {
      console.log(result);
    }
    console.log('Conversion completed successfully!');
  })
  .catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });

