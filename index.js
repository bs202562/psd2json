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

  // Helper function to crop image using Sharp
  async function resizeAndSaveImage(sourceFilePath, outputFilePath, originalWidth, originalHeight, layerX, layerY) {
    const maxWidth = maxResolution?.width || originalWidth;
    const maxHeight = maxResolution?.height || originalHeight;

    try {
      console.log(`Processing image from ${sourceFilePath} to ${outputFilePath}`);
      console.log(`Layer position: (${layerX}, ${layerY}), size: ${originalWidth}x${originalHeight}`);

      // 确保输入文件存在
      if (!fs.existsSync(sourceFilePath)) {
        throw new Error(`Source file does not exist: ${sourceFilePath}`);
      }

      // 确保输出目录存在
      const outputDir = path.dirname(outputFilePath);
      if (!fs.existsSync(outputDir)) {
        mkdirp.sync(outputDir);
      }

      // 获取图像元数据
      const metadata = await sharp(sourceFilePath).metadata();
      console.log(`Image metadata: ${metadata.width}x${metadata.height}`);

      // 计算可视区域的范围（最大分辨率范围）
      const visibleArea = {
        left: 0,
        top: 0,
        right: maxWidth,
        bottom: maxHeight
      };

      // 计算图层在可视区域中的范围
      const layerArea = {
        left: layerX,
        top: layerY,
        right: layerX + originalWidth,
        bottom: layerY + originalHeight
      };

      // 计算图层与可视区域的交集（即需要裁剪的部分）
      const intersection = {
        left: Math.max(visibleArea.left, layerArea.left),
        top: Math.max(visibleArea.top, layerArea.top),
        right: Math.min(visibleArea.right, layerArea.right),
        bottom: Math.min(visibleArea.bottom, layerArea.bottom)
      };

      // 检查是否有交集
      if (intersection.left >= intersection.right || intersection.top >= intersection.bottom) {
        console.log(`Layer is completely outside the visible area, nothing to crop`);
        // 图层完全在可视区域外，返回一个1x1的透明图像

        // 创建一个空白图像
        await sharp({
          create: {
            width: 1,
            height: 1,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          }
        }).toFile(outputFilePath);

        // 对于完全在可视区域外的图层，我们返回一个默认位置
        // 如果图层在可视区域的左侧或上方，则将其放在可视区域的边缘
        // 如果图层在可视区域的右侧或下方，则将其放在可视区域的边缘
        const newX = layerX < 0 ? 0 : (layerX > visibleArea.right ? visibleArea.right - 1 : layerX);
        const newY = layerY < 0 ? 0 : (layerY > visibleArea.bottom ? visibleArea.bottom - 1 : layerY);

        return { width: 1, height: 1, x: newX, y: newY };
      }

      // 计算交集区域的宽度和高度
      const intersectionWidth = intersection.right - intersection.left;
      const intersectionHeight = intersection.bottom - intersection.top;

      // 计算需要从原始图像中裁剪的区域
      // 需要将交集区域的坐标转换为相对于图层的坐标
      const cropArea = {
        left: Math.max(0, intersection.left - layerArea.left),
        top: Math.max(0, intersection.top - layerArea.top),
        width: intersectionWidth,
        height: intersectionHeight
      };

      console.log(`Cropping area: left=${cropArea.left}, top=${cropArea.top}, width=${cropArea.width}, height=${cropArea.height}`);

      // 确保裁剪区域不超出图像边界
      if (cropArea.left + cropArea.width > metadata.width) {
        cropArea.width = metadata.width - cropArea.left;
      }

      if (cropArea.top + cropArea.height > metadata.height) {
        cropArea.height = metadata.height - cropArea.top;
      }

      // 确保裁剪尺寸大于0
      if (cropArea.width <= 0 || cropArea.height <= 0) {
        console.log(`Invalid crop dimensions, creating empty image`);
        // 创建一个空白图像
        await sharp({
          create: {
            width: 1,
            height: 1,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          }
        }).toFile(outputFilePath);

        // 对于无效裁剪尺寸的情况，返回一个默认位置
        const newX = Math.max(0, layerX);
        const newY = Math.max(0, layerY);

        return { width: 1, height: 1, x: newX, y: newY };
      }

      // 裁剪并保存图像
      await sharp(sourceFilePath)
        .extract({
          left: cropArea.left,
          top: cropArea.top,
          width: cropArea.width,
          height: cropArea.height
        })
        .toFile(outputFilePath);

      // 计算裁剪后图像的新位置
      // 如果图层的左上角在可视区域外，新位置应该是可视区域的边界
      const newX = Math.max(0, layerX);
      const newY = Math.max(0, layerY);

      console.log(`Successfully cropped image to: ${outputFilePath} (${cropArea.width}x${cropArea.height})`);
      console.log(`New position: (${newX}, ${newY})`);

      return {
        width: cropArea.width,
        height: cropArea.height,
        x: newX,
        y: newY
      };
    } catch (error) {
      console.error(`Error during image processing: ${error.message}`);
      console.error(`Target max dimensions: ${maxWidth}x${maxHeight}`);
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
  const queueParentOffsets = []; // 新增：用于存储父组的坐标偏移

  // 兼容不同版本的psd.js库
  const children = rootNode._children || rootNode.children || [];
  queueNodes.push(children);
  queueNodesIndex.push(0);
  queueNodesName.push(undefined);
  const psdStructure = {
    'children' : []
  };
  queueNodesStructure.push(psdStructure);
  queueParentOffsets.push({ x: 0, y: 0 }); // 新增：根节点的偏移为(0,0)

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
    const parentOffset = queueParentOffsets[queueIndex]; // 新增：获取当前父组的偏移
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

      const dimensions = getMaskedDimensions(node);

      if (node.type === 'group') {
        queueNodes.push(node._children || node.children || []);
        queueNodesIndex[queueIndex] = nodesIndex;
        queueNodesIndex.push(0);
        queueNodesName.push(nodesName + node.name);
        const structure = {
          'name' : node.name,
          'type' : 'group',
          'x': dimensions.x - parentOffset.x, // 修改：计算相对坐标
          'y': dimensions.y - parentOffset.y, // 修改：计算相对坐标
          'width': dimensions.width,
          'height': dimensions.height,
          'children' : [] // 修改：使用 children 替代 group
        };
        nodesStructure.children.push(structure);
        queueNodesStructure.push(structure);
        queueParentOffsets.push({ x: dimensions.x, y: dimensions.y }); // 新增：推入当前组的绝对坐标作为子节点的偏移
        continue queueLoop;
      } else {
        const isTextLayer = typeof node.layer.typeTool === 'function';

        const structure = {
          'name' : node.name,
          'type' : isTextLayer ? 'text' : 'image',
          'x' : dimensions.x - parentOffset.x,
          'y' : dimensions.y - parentOffset.y,
          'width' : dimensions.width,
          'height' : dimensions.height
        };

        if (isTextLayer) {
          const textInfo = node.layer.typeTool();
          const textData = textInfo.obj?.textData || {};
          const style = textData.StyleRun?.RunArray?.[0]?.StyleSheet?.StyleSheetData || {};
          const fontInfo = style.Font || {};
          const colorArray = style.FillColor?.Values?.slice(1) || [0, 0, 0, 1];

          const fonts = textInfo.fonts();
          const sizes = textInfo.sizes();
          const colors = textInfo.colors();
          const textColor = colors[0];
          const cssColor = `rgba(${textColor[0]}, ${textColor[1]}, ${textColor[2]}, ${textColor[3]})`;

          structure.text = {
            'content': textInfo.obj?.textValue || '',
            'font': fonts[0] || 'default',
            'size': sizes[0] || 0,
            'color': cssColor,
            'alignment': textData.ParagraphRun?.RunArray?.[0]?.ParagraphSheet?.Properties?.Justification || 'left',
            'transform': textInfo.obj?.transform || {}
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
                console.log(`Smart object "${node.name}" needs processing (max dimensions: ${maxResolution.width}x${maxResolution.height})`);

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
                    dimensions.height,
                    dimensions.x,
                    dimensions.y
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

                  // 如果返回了新的位置信息，更新图层位置
                  if (result.x !== undefined && result.y !== undefined) {
                    structure.x = result.x;
                    structure.y = result.y;
                    console.log(`Updated position to (${result.x}, ${result.y})`);
                  }

                  console.log(`Successfully processed smart object "${node.name}" to ${result.width}x${result.height}`);
                } catch (error) {
                  console.error(`Failed to process smart object "${node.name}": ${error.message}`);
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

                  console.log(`Processing image ${outputPath} (max dimensions: ${maxResolution.width}x${maxResolution.height})`);

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

                  // 使用resizeAndSaveImage函数裁剪图像
                  const result = await resizeAndSaveImage(
                    tempFilePath,
                    outputPath,
                    dimensions.width,
                    dimensions.height,
                    dimensions.x,
                    dimensions.y
                  );

                  // 更新结构中的尺寸信息
                  structure.width = result.width;
                  structure.height = result.height;

                  // 如果返回了新的位置信息，更新图层位置
                  if (result.x !== undefined && result.y !== undefined) {
                    structure.x = result.x;
                    structure.y = result.y;
                    console.log(`Updated position to (${result.x}, ${result.y})`);
                  }

                  // 删除临时文件
                  try {
                    if (fs.existsSync(tempFilePath)) {
                      fs.unlinkSync(tempFilePath);
                    }
                  } catch (unlinkError) {
                    console.warn(`Warning: Could not delete temporary file: ${tempFilePath}`);
                  }

                  console.log(`Successfully processed and saved image: ${outputPath}`);

                  // 尺寸信息已在上面更新
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

        nodesStructure.children.push(structure);
      }
    }

    queueNodes.pop();
    queueNodesIndex.pop();
    queueNodesName.pop();
    queueNodesStructure.pop();
    queueParentOffsets.pop(); // 新增：当一个组处理完毕后，弹出其偏移
  }

  const outJsonData = JSON.stringify(psdStructure.children, null, 2);

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