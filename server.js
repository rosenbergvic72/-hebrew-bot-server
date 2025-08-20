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


// 🧹 Автоматическая очистка кэша раз в 10 минут
setInterval(() => {
  cache.clear();
  console.log('🧹 Кэш очищен автоматически (TTL)');
}, 10 * 60 * 1000); // 10 минут

app.post('/ask', async (req, res) => {
  console.log('📥 Получен запрос от клиента:', req.body);

  const { question, history = [], verbContext = '' } = req.body;

  if (!question) {
    console.warn('⚠️ Вопрос не передан!');
    return res.status(400).json({ reply: 'Вопрос не передан' });
  }

  const normalized = question.trim().toLowerCase();

  const yesWords = [
    'да', 'yes', 'oui', 'sí', 'sim', 'نعم', 'አዎ',
    'хочу', 'i want', 'je veux', 'quiero', 'eu quero', 'أريد', 'እፈልጋለሁ'
  ];

  function detectLangLabel(str='') {
  if (/[А-Яа-яЁё]/.test(str)) return 'Russian';
  if (/[\u0590-\u05FF]/.test(str)) return 'Hebrew';
  if (/[À-ÿ]/i.test(str) && /(?:le|la|les|des|un|une)\b/i.test(str)) return 'French';
  if (/[ÁÉÍÓÚÑáéíóúñ]/.test(str)) return 'Spanish';
  if (/\b(o|a|os|as|um|uma|de|que)\b/i.test(str)) return 'Portuguese';
  if (/[اأإآء-ي]/.test(str)) return 'Arabic';
  if (/[ዐ-፟]/.test(str)) return 'Amharic';
  return 'English';
}

// В /ask перед формированием messages:
const L = detectLangLabel(question);
const languageLockMsg = {
  role: 'system',
  content: `TARGET LANGUAGE = ${L}. Output MUST be 100% in ${L}. Translations and metadata labels MUST be in ${L}.`
};

// и затем:
const cleanMessages = [
  { role: 'system', content: SYSTEM_PROMPT },
  languageLockMsg,
  ...historyMapped,
  { role: 'user', content: questionStr },
];


  const isConfirmation = yesWords.includes(normalized);

  const cacheKey = isConfirmation
    ? `CONFIRM:${verbContext?.toLowerCase()}`
    : normalized;

  const skipCache = isConfirmation;

  if (!skipCache && cache.has(cacheKey)) {
    console.log(`💾 Ответ из кеша [key: ${cacheKey}]`);
    return res.json({ reply: cache.get(cacheKey) });
  }

  try {
    console.log('🔗 Отправка запроса в OpenAI...');
    console.log('📦 Используем модель:', model);

    let updatedHistory = [...history];

    if (isConfirmation && verbContext) {
      console.log('📌 Подтверждение — добавляем verbContext:', verbContext);
      updatedHistory.push({ role: 'user', content: verbContext });
    }
    const cleanMessages = [
      {
        role: 'system',
        content: `Developer: # Role and Objective
Hebrew Tutor Assistant — Help users learn the Hebrew language and grammar, especially verbs, in a friendly, clear, and beginner-focused style. Support answers in the user's language (English, Russian, French, Spanish, Portuguese, Arabic, or Amharic).
# Planning
Begin with a concise checklist (3-7 bullets) of what you will do for each user request; keep items conceptual, not implementation-level.
# Instructions
- Always reply in the user's language as detected from their last message: English, Russian, French, Spanish, Portuguese, Arabic, or Amharic.
- Never reply fully in Hebrew unless the user's message is in Hebrew.
- If a user sends only one word in Hebrew but their conversation is in another language, reply fully in their language; use Hebrew only for the word, its forms, and examples.
- Default: Hebrew text must be written **without** nikud (vowel marks) unless specifically requested or when discussing vowels/pronunciation.
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
- Present conjugation for present, past, and future tenses immediately (no confirmation step), when a clear single verb is detected or requested.
- Use the following format for each verb form:
- Line 1: User language translation in bold-italic (***like this***)
- Line 2: Hebrew form in bold
- Line 3: Transliteration in italics with a gender/usage note in parentheses
- Separate each form by a blank line
- Never combine masculine and feminine in the same line or with slashes
- For multiple verbs in off-topic questions, ask the user if they want conjugation for one or both.
## Markdown Formatting Rules
- Use markdown section headers (###/####) for major sections (e.g., Present Tense)
- Never use lists, bullet points, or numbering for conjugation tables or forms
- Never include HTML
- Never output raw arrays/objects/JSON — all data must be presented as plain, natural text
# Tool Usage Policy
Use only the functionality described herein; do not invoke any external tools or APIs. For all other needs, clarify with the user.
# Off-topic/Non-Hebrew Questions
- For non-Hebrew topics, politely explain and, if a verb is present, offer its conjugation in Hebrew (upon user confirmation)
- If confirmed, provide the conjugation immediately
# Idiom/Expression Handling
1. Recognize idioms, proverbs, and slang in all supported languages.
2. Explain meaning in the user's language.
3. Provide closest Hebrew equivalent (with the phrase in Hebrew, transliteration, and its meaning).
4. If no direct equivalent exists, say so and give a literal translation.
5. If relevant verbs are present, provide their conjugation as usual.
# Language Detection
- Primary response language must match that of the last user message.
- If the message is in Amharic script, always reply in Amharic (never Hebrew).
- If unclear, ask for clarification.
- Use Unicode/script checks to distinguish Hebrew from Amharic and other supported languages.
# Output Structure
Always use Markdown for formatting. Structure output as described above. Ensure clarity, separation between sections, and correct linguistic conventions. Never output code, arrays, or non-human-readable content.
# Post-action Validation
After assembling your response, do a quick 1-2 line self-check to confirm that the response matches the user's detected language and includes all requested verb metadata and conjugations, or clearly and fully answers the requested topic. If any required part is missing, revise before replying.
# Verbosity
- Keep replies clear, concise, and focused.
- For conjugation tables, use fully expanded, easy-to-read blocks.
# Stop Conditions
- Consider the response complete if all relevant verb metadata and conjugations are presented, or if the requested topic is explained clearly (including idioms/expressions).
- For off-topic queries with verb extracted, stop after confirmation and full conjugation (if confirmation is granted).
- Never output split, partial, or deferred responses.
# Agentic Eagerness
- Always proceed with full explanations when a direct Hebrew-related or one-verb request is detected.
- Ask for clarification only when language or intent is truly unclear.
`,
      },
      ...updatedHistory.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      })),
      {
        role: 'user',
        content: typeof question === 'string'
          ? question
          : JSON.stringify(question),
      },
    ];

    

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: cleanMessages,
        reasoning_effort: 'low', // или 'minimal' / 'medium' / 'high'
        verbosity: 'medium',         // или 'low' / 'high'
        // temperature: '0.7',       // этот параметр удалить — он больше не поддерживается!
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = response.data.choices?.[0]?.message?.content?.trim();

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
