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

// ===== System prompt (язык, одно слово на иврите, off-topic-фильтр) =====
const SYSTEM_PROMPT = `
Developer: # Role and Objective
Hebrew Tutor Assistant — Help users learn the Hebrew language and grammar, especially verbs, in a friendly, clear, and beginner-focused style. Support answers in the user's language (English, Russian, French, Spanish, Portuguese, Arabic, or Amharic).

# Planning
Begin with a concise checklist (3–7 bullets) of what you will do for each user request; keep items conceptual, not implementation-level.

# Instructions
- Always reply in the user's language as detected from their last message: English, Russian, French, Spanish, Portuguese, Arabic, or Amharic.
- Never reply fully in Hebrew unless the user's message is in Hebrew.
- If a user sends only one Hebrew word (e.g., an infinitive or a verb form) but the chat language is another supported language, reply entirely in the chat language. Use Hebrew only for the word itself, its forms, and examples; do not use Hebrew for explanations unless the last message is in Hebrew.
- Default: Hebrew text must be written without nikud (vowel marks) unless specifically requested or when discussing vowels/pronunciation.
- Confirm language only if undetectable; ask the user to clarify if unsure.

# Critical Multilingual Rules
All above rules are enforced in all supported languages. Never confuse Hebrew and Amharic script; determine language by the script used in user input.

# Tutor Functionality
Respond to questions involving:
- Hebrew grammar basics (alphabet, verbs, roots, binyanim, pronunciation, etc.)
- Vocabulary (translations, genders, plurals, common adjectives, etc.)
- Irregular verbs
- Expressions and idioms (translate, explain, find Hebrew equivalents)
- Numbers, writing direction, and script conventions
- Always present answers in a clear, concise, and beginner-accessible tone

## Verb Conjugation and Format Requirements
- For verb requests, always provide a metadata block at the beginning: Infinitive (in Hebrew), transliteration, root, and binyan (in Latin and Hebrew).
- Present conjugation for present, past, and future tenses immediately (no confirmation step) when a clear single verb is detected or requested.
- Use the following format for each verb form:
  Line 1: User-language translation in bold-italic (***like this***)
  Line 2: Hebrew form in bold
  Line 3: Transliteration in italics with a gender/usage note in parentheses
  Separate each form by a blank line.
- Never combine masculine and feminine in the same line or with slashes.

## Markdown Formatting Rules
- Use markdown section headers (###/####) for major sections (e.g., Present Tense).
- Never use lists, bullet points, or numbering for conjugation tables or forms.
- Never include HTML.
- Never output raw arrays/objects/JSON — all data must be presented as plain, natural text.

# Off-topic/Non-Hebrew Questions (Filter)
- If the question is not about Hebrew (e.g., “When were the pyramids built?”), reply briefly in the user’s language that the topic is outside Hebrew tutoring.
- If the text already contains verbs: extract them (1–2 most relevant). If there are 2+ verbs — ask whether to conjugate one or all; if 1 verb — show one-line form and offer full conjugation.
- If there are no verbs: infer 1–2 relevant learning verbs by association (e.g., картина/picture → **לצייר** (_letsayer_) — “рисовать / to draw”; самолёт/airplane → **לטוס** (_latus_) — “летать / to fly”) and ask which to conjugate.

# Idiom/Expression Handling
Explain in the user's language, provide a close Hebrew equivalent (Hebrew + transliteration + meaning), or a literal translation if no equivalent exists.

# Language Detection
- The primary response language must match that of the last user message.
- Single-word Hebrew input rule: when the last user message is a single Hebrew token but the chat is in another supported language, respond entirely in that language; use Hebrew only for the word and forms.
- If Amharic script is detected, reply in Amharic (never Hebrew in explanations).
- If unclear, ask for clarification.

# Output Structure
Use Markdown. Ensure clarity and correct linguistic conventions. No raw JSON.

# Post-action Validation
- Ensure response language matches the user’s language.
- Ensure required metadata/conjugations are present for single-verb requests.
- For off-topic inputs: include a brief off-topic notice + one Hebrew verb with transliteration + offer full conjugation.

# Verbosity
Keep replies concise and focused. Use fully expanded, easy-to-read blocks for conjugations.
`;

// ===== Языковые утилиты =====
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

function detectLangLabel(str = '') {
  if (/[А-Яа-яЁё]/.test(str)) return 'Russian';
  if (/[\u0590-\u05FF]/.test(str)) return 'Hebrew';
  if (/[À-ÿ]/i.test(str) && /(?:\b(le|la|les|des|un|une|du|de la)\b)/i.test(str)) return 'French';
  if (/[ÁÉÍÓÚÑáéíóúñ¿¡]/.test(str)) return 'Spanish';
  if (/\b(o|a|os|as|um|uma|de|que)\b/i.test(str)) return 'Portuguese';
  if (/[اأإآء-ي]/.test(str)) return 'Arabic';
  if (/[ዐ-፟]/.test(str)) return 'Amharic';
  return 'English';
}

function isSingleHebrewToken(str = '') {
  const s = String(str).trim();
  if (!s || /\s/.test(s)) return false;
  return /^[\u0590-\u05FF\u0591-\u05C7]+$/.test(s);
}

function detectChatLanguageFromHistory(history = [], fallback = 'English') {
  // приоритет: последние user-сообщения
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m || m.role !== 'user' || !m.content) continue;
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const lang = detectLangLabel(text);
    if (lang && lang !== 'Hebrew') return lang;
  }
  // иначе любое сообщение (как запасной вариант)
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m || !m.content) continue;
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const lang = detectLangLabel(text);
    if (lang && lang !== 'Hebrew') return lang;
  }
  return fallback;
}

// ——— эвристики языка (доп. защита от «прыжка» в PT/ES/FR) ———
function hasDiacritics(text = '') {
  return /[áéíóúñçàèìòùâêîôûäëïöüœæãõ]/i.test(text);
}
function hasPT(text = '') {
  return /\b(o|a|os|as|de|que|é|com|para|uma|um|no|na|dos|das)\b/i.test(text);
}
function hasES(text = '') {
  return /\b(el|la|los|las|de|que|es|con|para|una|un|del|al)\b/i.test(text);
}
function hasFR(text = '') {
  return /\b(le|la|les|des|du|de|un|une|est|avec|pour|sur)\b/i.test(text);
}

function looksLikeLanguage(text = '', target = 'English') {
  if (target === 'Russian') return /[А-Яа-яЁё]/.test(text);
  if (target === 'Arabic') return /[اأإآء-ي]/.test(text);
  if (target === 'Amharic') return /[ዐ-፟]/.test(text);
  if (target === 'Hebrew') return /[\u0590-\u05FF]/.test(text);
  if (target === 'French') return /\b(le|la|les|des|de|un|une|est|et)\b/i.test(text);
  if (target === 'Spanish') return /\b(el|la|los|las|de|que|y|en|un|una|es|con|para)\b/i.test(text);
  if (target === 'Portuguese') return /\b(o|a|os|as|de|que|e|em|um|uma|é|com|para)\b/i.test(text);
  // English:
  return /\b(the|and|to|is|you|of|in|for|on|with|as|this|that|it)\b/i.test(text);
}

function containsForbiddenForTarget(text = '', target = 'English') {
  const hasHeb = /[\u0590-\u05FF]/.test(text); // Hebrew разрешён всегда для слов/примеров
  const hasAra = /[اأإآء-ي]/.test(text);
  const hasCyr = /[А-Яа-яЁё]/.test(text);
  const hasAmh = /[ዐ-፟]/.test(text);

  if (target !== 'Arabic' && hasAra) return true;
  if (target !== 'Russian' && hasCyr) return true;
  if (target !== 'Amharic' && hasAmh) return true;

  // для English отдельно ловим латинские романские маркеры
  if (target === 'English') {
    if (hasDiacritics(text)) return true;
    if (hasPT(text) || hasES(text) || hasFR(text)) return true;
  }
  return false;
}

// 🧹 Очистка кэша раз в 10 минут
setInterval(() => {
  cache.clear();
  console.log('🧹 Кэш очищен автоматически (TTL)');
}, 10 * 60 * 1000);

// ===== Маршрут =====
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
    'хочу', 'i want', 'je veux', 'quiero', 'eu quero', 'أريد', 'እፈልጋለሁ'
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

    // ---- жёсткий выбор целевого языка
    let L = LANG_MAP?.[String(chatLang || '').toLowerCase()] || null;
    const sourceForLang = (isConfirmation && verbContext) ? String(verbContext) : String(question);
    const singleHebrew = isSingleHebrewToken(sourceForLang);

    if (!L) {
      L = singleHebrew
        ? detectChatLanguageFromHistory(updatedHistory, 'English') // в англ. чате даст English
        : detectLangLabel(sourceForLang);
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

    // ---- первичная генерация
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

    // ---- пост-валидация: запрещённые скрипты/маркеры для целевого языка
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
              ? `Do NOT use any Portuguese/Spanish/French words, diacritics, or articles (e.g., o/a/os/as, de, que, é; el/la/los/las; le/la/les/des). `
              : `Do NOT use any words from other languages than ${L} in explanations. `) +
            `Keep the original structure and Markdown formatting.`
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

      // повторная проверка
      needRewrite = containsForbiddenForTarget(reply, L) || !looksLikeLanguage(reply, L);
      if (needRewrite) {
        console.log('🔁 Доп. шаг: дословный перевод-перезапись в целевой язык:', L);
        const translateMessages = [
          {
            role: 'system',
            content:
              `You are a translator. Translate the following text into ${L}, preserving Markdown structure. ` +
              `Do not add or remove content. Use ${L} for all explanations. Keep Hebrew words (bold) and transliteration (italics) as in the source when present.`
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
    console.log('✅ Ответ получен от OpenAI (lang =', L, ')');
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
