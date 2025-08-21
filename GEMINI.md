# Gemini Project Context

## Project Overview

`psd2json` is a Node.js module and command-line tool designed to convert Adobe Photoshop (.psd) files into a structured JSON format. It can also extract and save individual layers as PNG images. This tool is useful for developers who need to programmatically access the layout, text, and image data from a PSD file, for example, to automate the creation of web pages or game assets from a design file.

## Core Functionality

The tool operates in two primary modes: as a JavaScript module or as a command-line interface (CLI).

-   **Library (`index.js`)**: The main module exports an `async` function that takes a PSD file path and an options object. It parses the PSD file, traverses its layer tree, and generates a JSON object representing the document structure. It can be configured to export image layers to a specified directory.
-   **CLI (`bin/cli.js`)**: The command-line interface provides a simple way to convert a PSD file from the terminal. It accepts the path to the PSD file and an optional output directory.

The core logic involves:
1.  Parsing the PSD file using the `psd` library.
2.  Recursively traversing the layer/group tree of the PSD.
3.  For each visible layer, extracting metadata such as name, type (image/text), position (x, y), and dimensions (width, height).
4.  For text layers, extracting detailed information like content, font, size, and color.
5.  For image layers, saving the layer's image data as a `.png` file, with options for resizing and cropping using the `sharp` library.

## Key Technologies

-   **Runtime**: Node.js
-   **PSD Parsing**: `psd`
-   **Image Processing**: `sharp`, `canvas`
-   **File System**: `mkdirp` (for creating directories)
-   **Testing**: `mocha`
-   **Linting**: `eslint`

## Project Commands

The following commands are defined in `package.json`:

-   `npm test`: Runs the linter (`eslint`) and then executes the test suite (`mocha`).
-   `npm run lint`: Lints the JavaScript files in the project.
-   `npm run cli`: Executes the command-line interface.
-   `npm run lint-fix`: Lints the code and automatically fixes issues.
