function questionBankBindingPresentation(status = {}) {
  const binding = status.binding;
  return binding ? { bound: true, label: `Bound: ${binding.store_id}`, authority: binding.db_authority_id, warning: 'Binding is fixed and cannot switch implicitly.' }
    : { bound: false, label: 'Not bound', authority: '', warning: 'Bind only after verifying the primary-host question bank drive.' };
}
async function bindQuestionBankStore(fetchImpl, url, status, session) {
  const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: session.authorization, 'x-device-id': session.authContext.deviceId }, body: JSON.stringify({ root: status.root }) });
  const data = await response.json();
  if (!response.ok || !data.success) throw Object.assign(new Error(data.error || 'QUESTION_BANK_BIND_FAILED'), { code: data.code, status: response.status });
  return data;
}
module.exports = { questionBankBindingPresentation, bindQuestionBankStore };
