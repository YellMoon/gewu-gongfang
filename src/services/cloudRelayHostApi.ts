function retiredLocalAuthorityError() {
  const error: any = new Error('LOCAL_AUTHORITY_RETIRED');
  error.code = 'LOCAL_AUTHORITY_RETIRED';
  return error;
}

export async function publishCloudHeartbeat() {
  throw retiredLocalAuthorityError();
}

export async function publishCloudSnapshot() {
  throw retiredLocalAuthorityError();
}

export async function processMiniappCloudTasks() {
  throw retiredLocalAuthorityError();
}

export default {
  publishCloudHeartbeat,
  publishCloudSnapshot,
  processMiniappCloudTasks,
};
