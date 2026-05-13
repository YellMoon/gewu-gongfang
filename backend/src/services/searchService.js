class SearchService {
  constructor() {
    this.endpoint = (process.env.OPENSEARCH_ENDPOINT || '').replace(/\/$/, '');
    this.index = process.env.OPENSEARCH_QUESTION_INDEX || 'questions';
  }

  enabled() {
    return !!this.endpoint && typeof fetch === 'function';
  }

  async indexQuestion(document) {
    if (!this.enabled()) return { queued: true, reason: 'opensearch-disabled' };
    const res = await fetch(`${this.endpoint}/${this.index}/_doc/${encodeURIComponent(document.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
    });
    if (!res.ok) throw new Error(`OpenSearch index failed: HTTP ${res.status}`);
    return res.json();
  }

  async searchQuestions(keyword, filters = {}) {
    if (!this.enabled()) return null;
    const must = [];
    if (keyword) {
      must.push({
        multi_match: {
          query: keyword,
          fields: ['stem^3', 'answer', 'explanation', 'source'],
        },
      });
    }
    for (const [field, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        must.push({ term: { [field]: value } });
      }
    }
    const res = await fetch(`${this.endpoint}/${this.index}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { bool: { must } }, size: 50 }),
    });
    if (!res.ok) throw new Error(`OpenSearch search failed: HTTP ${res.status}`);
    return res.json();
  }
}

module.exports = new SearchService();
