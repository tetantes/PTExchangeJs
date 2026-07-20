const QRCode = require('qrcode');

async function generateQrBuffer(text) {
  return QRCode.toBuffer(text, { width: 512, margin: 2 });
}

module.exports = { generateQrBuffer };
