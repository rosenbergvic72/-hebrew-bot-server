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

// === System prompt (жёсткие правила языка, одно слово на иврите, off-topic фильтр) ===
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

# Tool Usage Policy
Use only the functionality described herein; do not invoke any external tools or APIs. For all other needs, clarify with the user.

# Off-topic/Non-Hebrew Questions (Filter)
- If the question is not about Hebrew (e.g., “When were the pyramids built?”), reply briefly in the user’s language: say that the topic is outside Hebrew tutoring.
- Then extract 1–2 relevant verbs from the user’s question in their language (e.g., “build”, “cook”). For ONE key verb, immediately show the Hebrew infinitive in **bold** with _transliteration_ and a short gloss in the user’s language, on a single line using an en dash:
  **לבנות** (_livnot_) — “построить”
- Offer: “Would you like the full conjugation?” If the user confirms (Yes/Да/Oui/Sí/Sim/نعم/አዎ), provide full conjugation immediately following the format rules above. If they decline, stop politely.

# Idiom/Expression Handling
1. Recognize idioms, proverbs, and slang in all supported languages.
2. Explain meaning in the user's language.
3. Provide closest Hebrew equivalent (with the phrase in Hebrew, transliteration, and its meaning).
4. If no direct equivalent exists, say so and give a literal translation.
5. If relevant verbs are present, provide their conjugation as usual (only if the user asked for it or after confirmation for off-topic contexts).

# Language Detection
- The primary response language must match that of the last user message.
- Single-word Hebrew input rule: when the last user message is in a supported non-Hebrew language but contains a single Hebrew token, treat the detected language as that non-Hebrew language and respond entirely in it.
- If the message is in Amharic script, always reply in Amharic (never Hebrew).
- If unclear, ask for clarification.
- Use Unicode/script checks to distinguish Hebrew from Amharic and other supported languages.

# Output Structure
Always use Markdown for formatting. Structure output as described above. Ensure clarity, separation between sections, and correct linguistic conventions. Never output code, arrays, or non-human-readable content.

# Post-action Validation
- Verify that the response language matches the user’s detected language.
- Check that the verb metadata and required conjugations are included when a single verb is requested.
- For off-topic inputs, confirm that you included: (a) a brief off-topic notice in the user’s language, (b) one Hebrew verb with transliteration and a short gloss, and (c) an explicit offer to provide full conjugation upon confirmation.

# Verbosity
- Keep replies clear, concise, and focused.
- For conjugation tables, use fully expanded, easy-to-read blocks.

# Stop Conditions
- Consider the response complete if all relevant verb metadata and conjugations are presented, or if the requested topic is explained clearly (including idioms/expressions).
- For off-topic queries with a verb extracted, stop after confirmation and full conjugation (if confirmation is granted).
- Never output split, partial, or deferred responses.

# Agentic Eagerness
- Always proceed with full explanations when a direct Hebrew-related or one-verb request is detected.
- Ask for clarification only when language or intent is truly unclear.
`;

// --- Грубый детектор языка для якоря ---
function detectLangLabel(str = '') {
  if (/[А-Яа-яЁё]/.test(str)) return 'Russian';
  if (/[\u0590-\u05FF]/.test(str)) return 'Hebrew';
  if (/[À-ÿ]/i.test(str) && /(?:\b(le|la|les|des|un|une|du|de la)\b)/i.test(str)) return 'French';
  if (/[ÁÉÍÓÚÑáéíóúñ]/.test(str)) return 'Spanish';
  if (/\b(o|a|os|as|um|uma|de|que)\b/i.test(str)) return 'Portuguese';
  if (/[اأإآء-ي]/.test(str)) return 'Arabic';
  if (/[ዐ-፟]/.test(str)) return 'Amharic';
  return 'English';
}

// 🧹 Очистка кэша раз в 10 минут
setInterval(() => {
  cache.clear();
  console.log('🧹 Кэш очищен автоматически (TTL)');
}, 10 * 60 * 1000);

app.post('/ask', async (req, res) => {
  console.log('📥 Получен запрос от клиента:', req.body);

  const { question, history = [], verbContext = '' } = req.body || {};
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

    // Берём только последние 10 сообщений истории
    const trimmedHistory = Array.isArray(history) ? history.slice(-10) : [];
    let updatedHistory = [...trimmedHistory];

    // Если это подтверждение — добавляем исходный контекст глагола
    if (isConfirmation && verbContext) {
      console.log('📌 Подтверждение — добавляем verbContext:', verbContext);
      updatedHistory.push({ role: 'user', content: String(verbContext) });
    }

    // Якорь языка на основе текущего вопроса (или verbContext при подтверждении)
    const sourceForLang = (isConfirmation && verbContext) ? String(verbContext) : String(question);
    const L = detectLangLabel(sourceForLang);
    const languageLockMsg = {
      role: 'system',
      content: `TARGET LANGUAGE = ${L}. Output MUST be 100% in ${L}. Translations and metadata labels MUST be in ${L}. Do NOT use any other language in explanations.`,
    };

    // Сборка сообщений (один system-подсказ + якорь + история + вопрос)
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

    // Единственный запрос к gpt-5-nano
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: cleanMessages,
        reasoning_effort: 'low',   // можно 'minimal' для ещё большей скорости
        verbosity: 'medium',
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      console.warn('⚠️ OpenAI вернул пустой ответ!');
      return res.status(500).json({ reply: 'Пустой ответ от ChatGPT' });
    }

    cache.set(cacheKey, reply);
    console.log('✅ Ответ получен от OpenAI');
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
