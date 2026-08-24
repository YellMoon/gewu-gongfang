const CONTACT_SLOTS = Object.freeze([
  Object.freeze({ slot: 1, relationship: 'student', phoneField: 'phone', wechatField: 'student_wechat' }),
  Object.freeze({ slot: 2, relationship: 'guardian', phoneField: 'parent_phone', wechatField: 'parent_wechat' }),
  Object.freeze({ slot: 3, relationship: 'guardian', phoneField: 'second_parent_phone', wechatField: 'second_parent_wechat' }),
]);

function contactText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function owns(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

export function studentContactFormValues(student = {}, contacts = []) {
  const bySlot = new Map(
    contacts
      .filter(contact => contact?.student_id === student.id)
      .map(contact => [Number(contact.slot), contact]),
  );
  const valueFor = (slot, field, legacyField) => {
    const contact = bySlot.get(slot);
    if (contact) return contact[field] ?? undefined;
    return student[legacyField] ?? undefined;
  };
  return Object.freeze({
    phone: valueFor(1, 'phone', 'phone'),
    student_wechat: valueFor(1, 'wechat', 'student_wechat'),
    parent_phone: valueFor(2, 'phone', 'parent_phone'),
    parent_wechat: valueFor(2, 'wechat', 'parent_wechat'),
    second_parent_phone: valueFor(3, 'phone', 'second_parent_phone'),
    second_parent_wechat: valueFor(3, 'wechat', 'second_parent_wechat'),
  });
}

export function overlayStudentContactDraftProjection(student = {}, contacts = []) {
  if (typeof student.id !== 'string' || !student.id.trim() || !Array.isArray(contacts)) {
    throw Object.assign(new Error('STUDENT_CONTACT_DRAFT_PROJECTION_INVALID'), {
      code: 'STUDENT_CONTACT_DRAFT_PROJECTION_INVALID',
    });
  }
  const otherContacts = contacts.filter(contact => contact?.student_id !== student.id);
  const existingBySlot = new Map(
    contacts
      .filter(contact => contact?.student_id === student.id)
      .map(contact => [Number(contact.slot), contact]),
  );
  const projected = CONTACT_SLOTS.flatMap(definition => {
    const existing = existingBySlot.get(definition.slot);
    const phone = owns(student, definition.phoneField)
      ? contactText(student[definition.phoneField])
      : contactText(existing?.phone);
    const wechat = owns(student, definition.wechatField)
      ? contactText(student[definition.wechatField])
      : contactText(existing?.wechat);
    if (!existing && !phone && !wechat) return [];
    return [{
      ...(existing || {}),
      student_id: student.id,
      slot: definition.slot,
      relationship: definition.relationship,
      phone,
      wechat,
      status: existing?.status || 'draft',
      created_at: existing?.created_at ?? null,
      updated_at: existing?.updated_at ?? null,
    }];
  });
  return [...otherContacts, ...projected];
}

