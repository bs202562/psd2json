const fs = require('fs');
const path = require('path');
const psd = require('psd');
const mkdirp = require('mkdirp');
const sharp = require('sharp'); // 使用sharp库进行图像处理

/**
 * Output PSD layout to JSON
 * @param {string} psdFile Relative path or absolute path of PSD file
 * @param {string|Object} [options] directory path or options
 * @param {string} [options.outJsonDir] Set to output files
 * @param {string} [options.outImgDir] Set to output files
 * @param {boolean} [options.flattenImagePath] If true, all images will be exported to a single directory with unique names
 * @param {Object} [options.maxResolution] Maximum resolution constraint for exported images
 * @param {number} [options.maxResolution.width] Maximum width in pixels
 * @param {number} [options.maxResolution.height] Maximum height in pixels
 * @returns {Promise<string>} JSON string of the PSD structure
 */
async function psd2json(psdFile, options = {}) {
  const psdFilePath = path.resolve(psdFile);
  const psdFileName = path.basename(psdFilePath, path.extname(psdFilePath));

  let outImgDir = '';
  let outJsonDir = '';
  let flattenImagePath = false;
  let maxResolution = null;

  if (typeof options === 'string') {
    outImgDir = options;
    outJsonDir = options;
  } else {
    outImgDir = options.outImgDir || '';
    outJsonDir = options.outJsonDir || '';
    flattenImagePath = options.flattenImagePath || false;
    maxResolution = options.maxResolution || null;
  }

  // Store used filenames to ensure uniqueness
  const usedFileNames = new Set();

  // Helper function to generate unique filename
  function getUniqueFileName(baseName, nodePath) {
    if (!flattenImagePath) {
      return baseName;
    }

    // Remove file extension if present
    let nameWithoutExt = baseName.replace(/\.[^/.]+$/, "");

    // Create a unique name by combining path segments when in flatten mode
    if (nodePath) {
      nameWithoutExt = nodePath.split(path.sep).filter(Boolean).join('_') + '_' + nameWithoutExt;
    }

    let uniqueName = nameWithoutExt;
    let counter = 1;

    // Add number suffix if name is already used
    while (usedFileNames.has(uniqueName + '.png')) {
      uniqueName = `${nameWithoutExt}_${counter}`;
      counter++;
    }

    uniqueName += '.png';
    usedFileNames.add(uniqueName);
    return uniqueName;
  }

  // Helper function to calculate scaled dimensions
  function calculateScaledDimensions(width, height) {
    if (!maxResolution || (!maxResolution.width && !maxResolution.height)) {
      return { width, height };
    }

    const maxWidth = maxResolution.width || Infinity;
    const maxHeight = maxResolution.height || Infinity;

    // 计算缩放比例
    const scale = Math.min(
      maxWidth / width,
      maxHeight / height,
      1 // 确保不会放大图片
    );

    // 向下取整以确保不超过最大分辨率
    return {
      width: Math.floor(width * scale),
      height: Math.floor(height * scale)
    };
  }

  // Helper function to resize and save image using Sharp
  async function resizeAndSaveImage(sourceFilePath, outputFilePath, originalWidth, originalHeight) {
    const { width, height } = calculateScaledDimensions(originalWidth, originalHeight);

    try {
      console.log(`Resizing image from ${sourceFilePath} to ${outputFilePath} (${width}x${height})`);

      // 确保输入文件存在
      if (!fs.existsSync(sourceFilePath)) {
        throw new Error(`Source file does not exist: ${sourceFilePath}`);
      }

      // 确保输出目录存在
      const outputDir = path.dirname(outputFilePath);
      if (!fs.existsSync(outputDir)) {
        mkdirp.sync(outputDir);
      }

      // 使用Sharp库调整图像大小
      await sharp(sourceFilePath)
        .resize({
          width: Math.floor(width),
          height: Math.floor(height),
          fit: 'fill' // 确保图像精确调整到指定尺寸
        })
        .toFile(outputFilePath);

      console.log(`Successfully resized image to: ${outputFilePath}`);
      return { width, height };
    } catch (error) {
      console.error(`Error during image resizing: ${error.message}`);
      console.error(`Target dimensions: ${width}x${height}`);
      throw error;
    }
  }

  // get root node.
  const psdData = psd.fromFile(psdFilePath);
  psdData.parse();
  const rootNode = psdData.tree();

  const queueNodes = [];
  const queueNodesIndex = [];
  const queueNodesName = [];
  const queueNodesStructure = [];

  // 兼容不同版本的psd.js库
  const children = rootNode._children || rootNode.children || [];
  queueNodes.push(children);
  queueNodesIndex.push(0);
  queueNodesName.push(undefined);
  const psdStructure = {
    'group' : []
  };
  queueNodesStructure.push(psdStructure);

  // Helper function to get masked dimensions
  function getMaskedDimensions(node) {
    if (node.layer.mask && node.layer.mask.width && node.layer.mask.height) {
      return {
        x: node.layer.mask.left || node.layer.left,
        y: node.layer.mask.top || node.layer.top,
        width: node.layer.mask.width,
        height: node.layer.mask.height
      };
    }

    if (node.layer.clipped) {
      let baseLayer = node;
      while (baseLayer.layer.clipped) {
        const siblings = baseLayer.parent._children;
        const index = siblings.indexOf(baseLayer);
        if (index > 0) {
          baseLayer = siblings[index - 1];
        }
      }

      if (baseLayer.layer.mask) {
        return {
          x: baseLayer.layer.mask.left || baseLayer.layer.left,
          y: baseLayer.layer.mask.top || baseLayer.layer.top,
          width: baseLayer.layer.mask.width,
          height: baseLayer.layer.mask.height
        };
      }
    }

    return {
      x: node.layer.left,
      y: node.layer.top,
      width: node.layer.width,
      height: node.layer.height
    };
  }

  queueLoop: while (0 < queueNodes.length) {
    const queueIndex = queueNodes.length - 1;
    const nodes = queueNodes[queueIndex];
    const nodesStructure = queueNodesStructure[queueIndex];
    let nodesIndex = queueNodesIndex[queueIndex];
    let nodesName = queueNodesName[queueIndex];

    if (nodesName === undefined) {
      nodesName = '';
    } else {
      nodesName += path.sep;
    }

    while (nodesIndex < nodes.length) {
      const node = nodes[nodesIndex];
      nodesIndex++;
      if (node.layer.visible === false) continue;

      if (node.type === 'group') {
        queueNodes.push(node._children || node.children || []);
        queueNodesIndex[queueIndex] = nodesIndex;
        queueNodesIndex.push(0);
        queueNodesName.push(nodesName + node.name);
        const structure = {
          'name' : node.name,
          'type' : 'group',
          'group' : []
        };
        nodesStructure.group.push(structure);
        queueNodesStructure.push(structure);
        continue queueLoop;
      } else {
        const isTextLayer = node.layer.text != null;
        const dimensions = getMaskedDimensions(node);

        const structure = {
          'name' : node.name,
          'type' : isTextLayer ? 'text' : 'image',
          'x' : dimensions.x,
          'y' : dimensions.y,
          'width' : dimensions.width,
          'height' : dimensions.height
        };

        if (isTextLayer) {
          const textInfo = node.layer.text;
          structure.text = {
            'content': textInfo.value || '',
            'font': textInfo.font?.name || '',
            'size': textInfo.font?.sizes?.[0] || 0,
            'color': textInfo.font?.colors?.[0] || '',
            'alignment': textInfo.font?.alignment?.[0] || '',
            'transform': textInfo.transform || {}
          };
        } else if (outImgDir) {
          try {
            const uniqueFileName = getUniqueFileName(node.name + '.png', flattenImagePath ? nodesName : null);
            structure.fileName = uniqueFileName;

            const outImgDirPath = flattenImagePath
              ? path.resolve(outImgDir)
              : path.resolve(outImgDir, psdFileName, nodesName);

            if (!fs.existsSync(outImgDirPath)) {
              mkdirp.sync(outImgDirPath);
            }

            const outputPath = path.join(outImgDirPath, uniqueFileName);
            let exportImage;

            if (node.layer.clipped) {
              exportImage = node.layer.mergeClippingMask();
              if (!exportImage) {
                throw new Error('Failed to merge clipping mask');
              }
            } else {
              exportImage = node.layer.image;
              if (!exportImage) {
                throw new Error('Layer image is null');
              }
            }

            // 确保图片对象有必要的方法
            if (!exportImage.scale && !exportImage.resize) {
              console.warn(`Smart object detected: "${node.name}". Processing...`);

              // 检查是否需要调整大小
              const { width, height } = calculateScaledDimensions(dimensions.width, dimensions.height);
              const needsResize = width !== dimensions.width || height !== dimensions.height;

              if (needsResize && maxResolution) {
                console.log(`Smart object "${node.name}" needs resizing from ${dimensions.width}x${dimensions.height} to ${width}x${height}`);

                try {
                  // 先保存原始图像，然后使用resizeAndSaveImage调整大小
                  // 创建临时文件路径
                  const tempFileName = `temp_${Date.now()}_${path.basename(outputPath)}`;
                  const tempFilePath = path.join(path.dirname(outputPath), tempFileName);

                  // 确保临时文件目录存在
                  const tempDir = path.dirname(tempFilePath);
                  if (!fs.existsSync(tempDir)) {
                    mkdirp.sync(tempDir);
                  }

                  // 保存原始图像到临时文件
                  if (exportImage.saveAsPng) {
                    await exportImage.saveAsPng(tempFilePath);
                  } else if (exportImage.save) {
                    await exportImage.save(tempFilePath);
                  } else {
                    throw new Error(`Cannot save image for smart object "${node.name}": no save method available`);
                  }

                  // 确认临时文件已创建
                  if (!fs.existsSync(tempFilePath)) {
                    throw new Error(`Failed to create temporary file: ${tempFilePath}`);
                  }

                  console.log(`Temporary file created: ${tempFilePath}`);

                  // 使用resizeAndSaveImage调整大小
                  const result = await resizeAndSaveImage(
                    tempFilePath, // 传入临时文件路径而不是图像对象
                    outputPath,
                    dimensions.width,
                    dimensions.height
                  );

                  // 删除临时文件
                  try {
                    if (fs.existsSync(tempFilePath)) {
                      fs.unlinkSync(tempFilePath);
                      console.log(`Temporary file deleted: ${tempFilePath}`);
                    }
                  } catch (unlinkError) {
                    console.warn(`Warning: Could not delete temporary file: ${tempFilePath}`);
                  }

                  // 更新结构中的尺寸信息
                  structure.width = result.width;
                  structure.height = result.height;
                  console.log(`Successfully resized smart object "${node.name}" to ${result.width}x${result.height}`);
                } catch (error) {
                  console.error(`Failed to resize smart object "${node.name}": ${error.message}`);
                  console.log(`Falling back to original image for smart object "${node.name}"`);

                  try {
                    // 如果调整大小失败，直接保存原始图像
                    if (exportImage.saveAsPng) {
                      await exportImage.saveAsPng(outputPath);
                      console.log(`Saved original smart object "${node.name}" to ${outputPath}`);
                    } else if (exportImage.save) {
                      await exportImage.save(outputPath);
                      console.log(`Saved original smart object "${node.name}" to ${outputPath}`);
                    } else {
                      throw new Error(`Cannot save image for smart object "${node.name}": no save method available`);
                    }

                    // 保持原始尺寸
                    structure.width = dimensions.width;
                    structure.height = dimensions.height;
                  } catch (saveError) {
                    console.error(`Failed to save original smart object "${node.name}": ${saveError.message}`);
                    // 继续处理其他图层，但记录错误
                  }
                }
              } else {
                // 不需要调整大小，直接保存原始图像
                try {
                  if (exportImage.saveAsPng) {
                    await exportImage.saveAsPng(outputPath);
                    console.log(`Saved smart object "${node.name}" to ${outputPath}`);
                  } else if (exportImage.save) {
                    await exportImage.save(outputPath);
                    console.log(`Saved smart object "${node.name}" to ${outputPath}`);
                  } else {
                    throw new Error(`Cannot save image for smart object "${node.name}": no save method available`);
                  }

                  // 保持原始尺寸
                  structure.width = dimensions.width;
                  structure.height = dimensions.height;
                } catch (error) {
                  console.error(`Failed to save smart object "${node.name}": ${error.message}`);
                  // 继续处理其他图层，但记录错误
                }
              }
            } else {
              // 对于正常图层，尝试调整大小并保存
              try {
                // 检查是否需要调整大小
                const { width, height } = calculateScaledDimensions(dimensions.width, dimensions.height);
                const needsResize = width !== dimensions.width || height !== dimensions.height;

                if (needsResize && maxResolution) {
                  // 如果需要调整大小，先保存原始图像到临时文件
                  const tempFileName = `temp_${Date.now()}_${path.basename(outputPath)}`;
                  const tempFilePath = path.join(path.dirname(outputPath), tempFileName);

                  console.log(`Attempting to resize image ${outputPath} from ${dimensions.width}x${dimensions.height} to ${width}x${height}`);

                  // 保存原始图像到临时文件
                  if (exportImage.saveAsPng) {
                    await exportImage.saveAsPng(tempFilePath);
                  } else if (exportImage.save) {
                    await exportImage.save(tempFilePath);
                  } else {
                    throw new Error('Image object does not have required methods');
                  }

                  // 确认临时文件已创建
                  if (!fs.existsSync(tempFilePath)) {
                    throw new Error(`Failed to create temporary file: ${tempFilePath}`);
                  }

                  // 使用Sharp库调整图像大小
                  await sharp(tempFilePath)
                    .resize({
                      width: Math.floor(width),
                      height: Math.floor(height),
                      fit: 'fill' // 确保图像精确调整到指定尺寸
                    })
                    .toFile(outputPath);

                  // 删除临时文件
                  try {
                    if (fs.existsSync(tempFilePath)) {
                      fs.unlinkSync(tempFilePath);
                    }
                  } catch (unlinkError) {
                    console.warn(`Warning: Could not delete temporary file: ${tempFilePath}`);
                  }

                  console.log(`Successfully resized and saved image: ${outputPath}`);

                  // 更新结构中的尺寸信息
                  structure.width = width;
                  structure.height = height;
                } else {
                  // 不需要调整大小，直接保存原始图像
                  if (exportImage.saveAsPng) {
                    await exportImage.saveAsPng(outputPath);
                  } else if (exportImage.save) {
                    await exportImage.save(outputPath);
                  } else {
                    throw new Error('Image object does not have required methods');
                  }

                  console.log(`Saved image without resizing: ${outputPath}`);
                }
              } catch (resizeError) {
                console.error(`Failed to resize image for "${node.name}": ${resizeError.message}`);
                // 继续处理其他图层，但记录错误
              }
            }
          } catch (error) {
            console.error(`Error processing layer "${node.name}": ${error.message}`);
            // 继续处理其他图层，但记录错误
          }
        }

        nodesStructure.group.push(structure);
      }
    }

    queueNodes.pop();
    queueNodesIndex.pop();
    queueNodesName.pop();
    queueNodesStructure.pop();
  }

  const outJsonData = JSON.stringify(psdStructure.group, null, 2);

  if (outJsonDir) {
    const outJsonDirPath = path.resolve(outJsonDir);
    const outJsonPath = path.join(outJsonDirPath, psdFileName + '.json');
    if (!fs.existsSync(outJsonDirPath)) {
      fs.mkdirSync(outJsonDirPath);
    }
    fs.writeFileSync(outJsonPath, outJsonData);
  }

  return outJsonData;
}

// 为了向后兼容，我们提供一个同步版本的包装器
async function psd2jsonSync(psdFile, options = {}) {
  console.warn('Warning: Using synchronous version of psd2json. This may not handle smart objects correctly.');
  try {
    return await psd2json(psdFile, options);
  } catch (err) {
    console.error('Error in async psd2json:', err);
    throw err;
  }
}

module.exports = psd2jsonSync;
module.exports.async = psd2json;