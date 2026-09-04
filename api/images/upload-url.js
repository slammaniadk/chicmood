const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { r2, R2_BUCKET, R2_PUBLIC_URL } = require('../_lib/r2');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const { filename, contentType } = req.body;

  if (!filename) {
    return fail(res, 'filename은 필수입니다');
  }

  const ext = filename.split('.').pop();
  const path = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: path,
      ContentType: contentType || 'application/octet-stream',
    });

    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 600 });
    const publicUrl = `${R2_PUBLIC_URL}/${path}`;

    return ok(res, {
      signedUrl,
      token: '',
      path,
      publicUrl,
    });
  } catch (err) {
    return fail(res, err.message, 500);
  }
};
