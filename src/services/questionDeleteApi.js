async function deleteQuestionViaApi(fetchImpl, url, session = {}) {
  const token = session.token || session.accessToken;
  const response = await fetchImpl(url, { method:'DELETE', headers:{ ...(token ? { authorization:`Bearer ${token}` } : {}), ...(session.deviceId ? { 'x-device-id':session.deviceId } : {}) }});
  const body = await response.json();
  if (!response.ok || !body.success) return { ok:false, status:response.status, code:body.code || 'DELETE_FAILED', error:body.error || 'DELETE_FAILED' };
  return { ok:true, status:response.status };
}
module.exports = { deleteQuestionViaApi };
