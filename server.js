const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const cache = new Map();
const model = 'gpt-5-nano';

/* ========================= SYSTEM PROMPT ========================= */
const SYSTEM_PROMPT = `
Developer: # Role and Objective
Hebrew Tutor Assistant — Help users learn the Hebrew language and grammar, especially verbs, in a friendly, clear, and beginner-focused style. Support answers in the user's language (English, Russian, French, Spanish, Portuguese, Arabic, or Amharic).

# Core Behavior (Very Important)
- Never expose your internal reasoning, steps, or decision process. Do NOT write things like "I will first detect your language", "Step 1", "My reasoning is", or similar. Give only the final explanation suitable for a learner.
- Do not ask follow-up or clarifying questions unless the user’s request is truly impossible to answer without them. If you can reasonably guess what the user wants, do so and answer directly. At most, mention briefly which interpretation you chose.
- Do not end answers with meta-comments like "If you want, I can continue" or "Let me know if you’d like more examples". Give a complete, compact answer for the current question and stop.

# Instructions
- Always reply in the user's language as detected from their last message: English, Russian, French, Spanish, Portuguese, Arabic, or Amharic.
- Never reply fully in Hebrew unless the user's message is in Hebrew.
- If a user sends only one Hebrew word (e.g., an infinitive or a verb form) but the chat language is another supported language, reply entirely in the chat language. Use Hebrew only for the word itself, its forms, and examples; do not use Hebrew for explanations unless the last message is in Hebrew.
- Default: Hebrew text must be written without nikud (vowel marks) unless specifically requested or when discussing vowels/pronunciation.
- Confirm language only if undetectable; ask the user to clarify only if you genuinely cannot determine the language.

# Critical Multilingual Rules
All above rules are enforced in all supported languages. Never confuse Hebrew and Amharic script; determine language by the script used in user input.

# Tutor Functionality
Respond to questions involving:
- Hebrew grammar basics (alphabet, verbs, roots, binyanim, pronunciation, etc.)
- Vocabulary (translations, genders, plurals, common adjectives, etc.)
- Irregular verbs
- Expressions and idioms (translate, explain, find Hebrew equivalents)
- Numbers, writing direction, and script conventions
- Always present answers in a clear, concise, and beginner-accessible tone.

## Verb Conjugation and Format Requirements
- For verb requests, always provide a metadata block at the beginning: Infinitive (in Hebrew), transliteration, root, and binyan (in Latin and Hebrew).
- Present conjugation for present, past, and future tenses immediately (no confirmation step) when a clear single verb is detected or requested.
- Use the following format for each verb form (no bullet points, no numbering):
  Line 1: User-language translation in bold-italic (***like this***)
  Line 2: Hebrew form in bold
  Line 3: Transliteration in italics with a gender/usage note in parentheses
  Then one blank line before the next form.
- Never combine masculine and feminine in the same line or with slashes.

## Global Markdown Formatting Rules (Critical for Rendering)
These rules are critical for rendering in the mobile app:
- Use Markdown section headers (### / ####) for major sections (for example: "### Present Tense", "### Examples").
- Do NOT use Markdown lists at all anywhere in the answer:
  - No bullet lists that start a line with "-", "*" or "+" followed by a space.
  - No numbered lists that start a line with "1." , "2." and so on.
- Instead of lists, use short paragraphs and manual line breaks. Each example or mini-block should be separated by at least one blank line.
- Never include HTML.
- Never output raw arrays, objects, or JSON — all data must be presented as plain, natural text.

## Example Formatting for Examples (not conjugation tables)
When you need multiple examples (for example 6–8), follow this pattern (no bullets, no numbers):

Short description in the user language (1 short sentence with the key idea).

**Hebrew word or phrase**  
_transliteration_  
User-language translation  

Then a blank line, and the next example in the same format.

# Off-topic/Non-Hebrew Questions (Filter)
- If the question is not about Hebrew, reply briefly in the user’s language that the topic is outside Hebrew tutoring.
- If the text already contains verbs: extract them (1–2 most relevant). If there are 2 or more verbs, you may ask ONE short clarifying question ("Which verb would you like to focus on?") and then wait for the answer. Do not ask multiple rounds of questions.
- If there is only 1 verb — show one-line form (Hebrew + transliteration + translation) and then give full conjugation in the usual format.
- If there are no verbs: infer 1–2 relevant learning verbs by association (e.g., картина / picture → "לצייר" (letsayer) — "рисовать / to draw"; airplane → "לטוס" (latus) — "лететь / to fly") and briefly suggest them, but do NOT start a long dialogue. Prefer giving at least one concrete conjugation instead of asking open questions.

# Idiom/Expression Handling
Explain in the user's language, provide a close Hebrew equivalent (Hebrew + transliteration + meaning), or a literal translation if no equivalent exists.

# Language Detection
- The primary response language must match that of the last user message.
- Single-word Hebrew input rule: when the last user message is a single Hebrew token but the chat is in another supported language, respond entirely in that language; use Hebrew only for the word and forms.
- If Amharic script is detected, reply in Amharic (never Hebrew in explanations).
- If unclear, ask for clarification once, very briefly.

# Output Structure
Use Markdown with:
- Clear headers for big sections.
- Short paragraphs (1–3 sentences) rather than long walls of text.
- No lists of any kind.
Ensure clarity and correct linguistic conventions. No raw JSON.

# Post-action Validation
Before sending the answer, silently check:
- Response language matches the user’s language.
- Required metadata and conjugations are present for single-verb requests.
- You did not expose internal reasoning or step-by-step thoughts.
- You did not use bullet lists or numbered lists anywhere.
- For off-topic inputs: include a brief off-topic notice plus at least one Hebrew verb with transliteration and (if appropriate) a compact conjugation.

# Verbosity
Keep replies concise and focused. Use fully expanded, easy-to-read blocks for conjugations, but do not add unnecessary commentary or follow-up offers.
`;

/* ========================= LANGUAGE UTILS ========================= */

const LANG_MAP = {
  en: 'English',
  ru: 'Russian',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  ar: 'Arabic',
  am: 'Amharic',
  he: 'Hebrew',
};

// Count characters by script
function scriptCounts(str = '') {
  return {
    he: (str.match(/[\u0590-\u05FF]/g) || []).length,
    ru: (str.match(/[А-Яа-яЁё]/g) || []).length,
    ar: (str.match(/[اأإآء-ي]/g) || []).length,
    am: (str.match(/[ዐ-፟]/g) || []).length,
    lat: (str.match(/[A-Za-z]/g) || []).length,
  };
}

// Latin-language stopwords (rough)
const EN_SW = /\b(the|and|to|is|you|of|in|for|on|with|as|this|that|it|pick|items|each|note|example)\b/i;
const FR_SW = /\b(le|la|les|des|du|de|un|une|est|avec|pour|sur|et|que)\b/i;
const ES_SW = /\b(el|la|los|las|de|que|y|en|un|una|es|con|para|del|al)\b/i;
const PT_SW = /\b(o|a|os|as|de|que|e|em|um|uma|é|com|para|no|na|dos|das)\b/i;

function detectLangLabelMixed(str = '') {
  const s = String(str);
  const { he, ru, ar, am, lat } = scriptCounts(s);

  // Pure script cases first
  if (he > 0 && lat === 0 && ru === 0 && ar === 0 && am === 0) return 'Hebrew';
  if (ru > 0 && he === 0 && lat === 0 && ar === 0 && am === 0) return 'Russian';
  if (ar > 0 && he === 0 && lat === 0 && ru === 0 && am === 0) return 'Arabic';
  if (am > 0 && he === 0 && lat === 0 && ru === 0 && ar === 0) return 'Amharic';

  // Mixed cases with Latin present → choose Latin language by stopwords (prefer EN)
  if (lat > 0) {
    if (EN_SW.test(s)) return 'English';
    if (ES_SW.test(s)) return 'Spanish';
    if (PT_SW.test(s)) return 'Portuguese';
    if (FR_SW.test(s)) return 'French';
    // Latin but no strong stopwords → fallback: English
    return 'English';
  }

  // No Latin, mixed among others → choose the dominant count
  const max = Math.max(he, ru, ar, am);
  if (max === he) return 'Hebrew';
  if (max === ru) return 'Russian';
  if (max === ar) return 'Arabic';
  if (max === am) return 'Amharic';
  return 'English';
}

function isSingleHebrewToken(str = '') {
  const s = String(str).trim();
  if (!s || /\s/.test(s)) return false;
  return /^[\u0590-\u05FF\u0591-\u05C7]+$/.test(s);
}

function detectChatLanguageFromHistory(history = [], fallback = 'English') {
  // prefer last user messages (non-Hebrew)
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m || m.role !== 'user' || !m.content) continue;
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const lang = detectLangLabelMixed(text);
    if (lang && lang !== 'Hebrew') return lang;
  }
  // else any message
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m || !m.content) continue;
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const lang = detectLangLabelMixed(text);
    if (lang && lang !== 'Hebrew') return lang;
  }
  return fallback;
}

// Additional guards for “language drift”
function hasDiacritics(text = '') {
  return /[áéíóúñçàèìòùâêîôûäëïöüœæãõ]/i.test(text);
}
function looksLikeLanguage(text = '', target = 'English') {
  if (target === 'Russian') return /[А-Яа-яЁё]/.test(text);
  if (target === 'Arabic') return /[اأإآء-ي]/.test(text);
  if (target === 'Amharic') return /[ዐ-፟]/.test(text);
  if (target === 'Hebrew') return /[\u0590-\u05FF]/.test(text);
  if (target === 'French') return FR_SW.test(text);
  if (target === 'Spanish') return ES_SW.test(text);
  if (target === 'Portuguese') return PT_SW.test(text);
  // English:
  return EN_SW.test(text) || /[A-Za-z]/.test(text);
}
function containsForbiddenForTarget(text = '', target = 'English') {
  const hasAra = /[اأإآء-ي]/.test(text);
  const hasCyr = /[А-Яа-яЁё]/.test(text);
  const hasAmh = /[ዐ-፟]/.test(text);

  if (target !== 'Arabic' && hasAra) return true;
  if (target !== 'Russian' && hasCyr) return true;
  if (target !== 'Amharic' && hasAmh) return true;

  if (target === 'English') {
    if (hasDiacritics(text)) return true;
    if (FR_SW.test(text) || ES_SW.test(text) || PT_SW.test(text)) return true;
  }
  return false;
}

/* ========================= CACHE TTL ========================= */
setInterval(() => {
  cache.clear();
  console.log('🧹 Кэш очищен автоматически (TTL)');
}, 10 * 60 * 1000);

/* ========================= ROUTE ========================= */
app.post('/ask', async (req, res) => {
  console.log('📥 Получен запрос от клиента:', req.body);

  const { question, history = [], verbContext = '', chatLang } = req.body || {};
  if (!question) {
    console.warn('⚠️ Вопрос не передан!');
    return res.status(400).json({ reply: 'Вопрос не передан' });
  }

  const normalized = String(question).trim().toLowerCase();
  const yesWords = [
    'да', 'yes', 'oui', 'sí', 'sim', 'نعم', 'አዎ',
    'хочу', 'i want', 'je veux', 'quiero', 'eu quero', 'أريد', 'እፈልጋለሁ',
  ];
  const isConfirmation = yesWords.includes(normalized);

  const cacheKey = isConfirmation
    ? `CONFIRM:${String(verbContext || '').toLowerCase()}`
    : normalized;

  const skipCache = isConfirmation;
  if (!skipCache && cache.has(cacheKey)) {
    console.log(`💾 Ответ из кеша [key: ${cacheKey}]`);
    return res.json({ reply: cache.get(cacheKey) });
  }

  try {
    console.log('🔗 Отправка запроса в OpenAI...');
    console.log('📦 Используем модель:', model);

    const trimmedHistory = Array.isArray(history) ? history.slice(-10) : [];
    let updatedHistory = [...trimmedHistory];

    if (isConfirmation && verbContext) {
      console.log('📌 Подтверждение — добавляем verbContext:', verbContext);
      updatedHistory.push({ role: 'user', content: String(verbContext) });
    }

    // 1) explicit lang from client
    let L = LANG_MAP?.[String(chatLang || '').toLowerCase()] || null;

    // 2) auto-detect with robust mixed-text logic
    const sourceForLang = isConfirmation && verbContext ? String(verbContext) : String(question);
    const singleHebrew = isSingleHebrewToken(sourceForLang);

    if (!L) {
      L = singleHebrew
        ? detectChatLanguageFromHistory(updatedHistory, 'English') // “one Hebrew word” → use chat language
        : detectLangLabelMixed(sourceForLang);
    }

    // Safety: if model guessed Hebrew but message is mixed with strong English markers → force English
    if (L === 'Hebrew' && /[A-Za-z]/.test(sourceForLang) && EN_SW.test(sourceForLang)) {
      L = 'English';
    }

    const languageLockMsg = {
      role: 'system',
      content: singleHebrew
        ? `TARGET LANGUAGE = ${L}. The last user message is a SINGLE Hebrew token. Still respond 100% in ${L}. Use Hebrew ONLY for the word itself, its forms, and examples. Do NOT use Hebrew in explanations unless TARGET LANGUAGE is Hebrew.`
        : `TARGET LANGUAGE = ${L}. Output MUST be 100% in ${L}. Translations and metadata labels MUST be in ${L}. Do NOT use any other language in explanations. If any sentence is not in ${L}, rewrite it into ${L} before sending.`,
    };

    const cleanMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      languageLockMsg,
      ...updatedHistory.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      })),
      {
        role: 'user',
        content: typeof question === 'string' ? question : JSON.stringify(question),
      },
    ];

    // ---- primary generation
    let response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: cleanMessages,
        reasoning_effort: 'low',
        verbosity: 'medium',
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let reply = response.data?.choices?.[0]?.message?.content?.trim() || '';

    // ---- post-validation & one or two-step rewrite if needed
    let needRewrite = containsForbiddenForTarget(reply, L) || !looksLikeLanguage(reply, L);
    if (needRewrite) {
      console.log('🛠️ Переписываем ответ строго на целевом языке:', L);
      const rewriteMessages = [
        {
          role: 'system',
          content:
            `You are a careful editor. Rewrite the assistant draft STRICTLY in ${L}. ` +
            `Allowed exceptions: Hebrew words for the target verb and its forms (bold) and transliteration (italics). ` +
            (L === 'English'
              ? 'Do NOT use any Portuguese, Spanish or French function words or diacritics (for example: o, a, os, as, de, que, é; el, la, los, las; le, la, les, des). '
              : `Do NOT use any words from other languages than ${L} in explanations. `) +
            'Keep the original structure and Markdown formatting.',
        },
        { role: 'user', content: `Rewrite entirely in ${L}:\n\n${reply}` },
      ];

      const rewriteResp = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: rewriteMessages,
          reasoning_effort: 'minimal',
          verbosity: 'low',
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      reply = rewriteResp.data?.choices?.[0]?.message?.content?.trim() || reply;

      // check again
      needRewrite = containsForbiddenForTarget(reply, L) || !looksLikeLanguage(reply, L);
      if (needRewrite) {
        console.log('🔁 Доп. шаг: дословный перевод-перезапись в целевой язык:', L);
        const translateMessages = [
          {
            role: 'system',
            content:
              `You are a translator. Translate the following text into ${L}, preserving Markdown structure. ` +
              'Do not add or remove content. Use the target language for all explanations. Keep Hebrew words (bold) and transliteration (italics) as in the source when present.',
          },
          { role: 'user', content: reply },
        ];

        const translateResp = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model,
            messages: translateMessages,
            reasoning_effort: 'minimal',
            verbosity: 'low',
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );
        reply = translateResp.data?.choices?.[0]?.message?.content?.trim() || reply;
      }
    }

    if (!reply) {
      console.warn('⚠️ OpenAI вернул пустой ответ!');
      return res.status(500).json({ reply: 'Пустой ответ от ChatGPT' });
    }

    cache.set(cacheKey, reply);
    console.log(`✅ Ответ получен от OpenAI (lang = ${L})`);
    return res.status(200).json({ reply });
  } catch (error) {
    console.error('❌ Ошибка запроса к OpenAI:', error.response?.data || error.message);
    return res.status(500).json({ reply: 'Ошибка при запросе к ChatGPT' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Сервер работает: http://localhost:${PORT}`);
});
