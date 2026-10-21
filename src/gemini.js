'use strict';
const { buildPrompt, parseIdeas, fallbackIdeas } = require('./planner');

const cache = new Map(); // small in-memory cache keeps us well inside free tier limits
const MAX_CACHE = 100;

async function getIdeas(v) {
  const key = JSON.stringify([v.type, v.guests, v.budget, v.city, v.vibe, v.tone, v.date.toISOString().slice(0, 10)]);
  if (cache.has(key)) return cache.get(key);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ...fallbackIdeas(v), aiPowered: false };
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: buildPrompt(v) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.9 } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const parsed = parseIdeas(data?.candidates?.[0]?.content?.parts?.[0]?.text);
    if (!parsed) throw new Error('Unusable AI output');
    const out = { ...parsed, aiPowered: true };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
  } catch (err) {
    console.error('Gemini fallback:', err.message); // never log the key or user text
    return { ...fallbackIdeas(v), aiPowered: false };
  }
}

module.exports = { getIdeas };
