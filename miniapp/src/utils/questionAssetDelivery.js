// NAS delivery is asynchronous. Keep the original task while it is preparing;
// a short fixed number of polls silently abandoned valid images under load.
async function loadQuestionAsset({ api, token, questionId, assetKey, isActive,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const deadline = now() + 120000;
  try {
    if (!isActive()) return null;
    const prepared = await api.requestQuestionAssetDelivery(token, questionId, assetKey);
    let delivery = prepared.data?.delivery;
    if (!prepared.success || !delivery || !isActive()) return null;
    const deliveryId = delivery.deliveryId;
    if (typeof deliveryId !== 'string' || !/^question_asset_delivery_[A-Za-z0-9_-]{8,128}$/.test(deliveryId)) return null;
    while (delivery.status === 'queued' || delivery.status === 'leased') {
      const remaining = deadline - now();
      if (remaining <= 0 || !isActive()) return null;
      await sleep(Math.min(1500, remaining));
      if (!isActive() || now() >= deadline) return null;
      const refreshed = await api.readQuestionAssetDelivery(token, deliveryId);
      if (!refreshed.success || refreshed.data?.delivery?.deliveryId !== deliveryId) return null;
      delivery = refreshed.data.delivery;
    }
    if (delivery.status !== 'ready' || !isActive() || now() >= deadline) return null;
    const downloaded = await api.downloadQuestionAssetDelivery(token, deliveryId);
    const tempFilePath = downloaded.data?.tempFilePath;
    return isActive() && downloaded.success && typeof tempFilePath === 'string' && tempFilePath ? tempFilePath : null;
  } catch {
    return null;
  }
}

module.exports = { loadQuestionAsset };
