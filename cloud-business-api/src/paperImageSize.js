'use strict';

// All document image sizes are CSS px. Treat imported dimensions as bounds,
// since older imports may contain independently resized width and height.
function paperImageSize(media) {
  const width = media.width, height = media.height;
  const scale = Math.min(1, 420 / width, 280 / height,
    media.displayWidth == null ? Infinity : media.displayWidth / width,
    media.displayHeight == null ? Infinity : media.displayHeight / height);
  return { width: width * scale, height: height * scale };
}

module.exports = { paperImageSize };
