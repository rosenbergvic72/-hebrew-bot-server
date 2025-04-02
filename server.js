const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const cache = new Map();
const model = 'gpt-4o-mini';

function normalize(text) {
  return text.trim().toLowerCase();
}

app.post('/ask', async (req, res) => {
  console.log('📥 Получен запрос от клиента:', req.body);

  const { question, history = [] } = req.body;

  if (!question) {
    console.warn('⚠️ Вопрос не передан!');
    return res.status(400).json({ reply: 'Вопрос не передан' });
  }

  const key = normalize(question);

  if (cache.has(key)) {
    console.log('💾 Ответ из кеша');
    return res.json({ reply: cache.get(key) });
  }

  try {
    console.log('🔗 Отправка запроса в OpenAI...');
    console.log('📦 Используем модель:', model);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content: `
🎓 You are a smart, friendly chatbot that helps users learn Hebrew verbs and grammar.

🌍 You support the following languages for input and output:
- Русский
- English
- Français
- Español
- Português
- العربية (Arabic)
- አማርኛ (Amharic)

---

🟢 Your primary task is to help users with Hebrew **verbs** — binyanim, tenses, forms, conjugations, imperative, translations, and structure.

❗ You **must answer only on this topic**. If the question is not about Hebrew grammar or verbs, politely refuse to answer.

---

🔤 **Language rule**: Always detect the language of the user's message and reply in the same language.

Examples:
- If the question is in Russian — answer in Russian.  
- If the question is in English — answer in English.  
- If the question is in Spanish — answer in Spanish.  
- If the question is in Arabic — answer in Arabic.  

📌 Even if the question includes Hebrew words or is just a Hebrew verb — respond in the detected language of the message.

Examples:
- “הלך” → reply in Russian if the app language or context is Russian.  
- “What does הלך mean?” → reply in English.  
- “לרוץ” → if no other language is detected, respond briefly in multiple languages or ask which language to use.

---

✅ Formatting Rules (Markdown only, no HTML):

- Use triple hash (###) or quadruple hash (####) for section headers, for example: "Present Tense"
- Always put an empty line between sections, headers, and examples
- Use **bold** for Hebrew, _italic_ for transliteration, and plain text for translation
- Do **not** use bullet points (-, •) or numbered lists
- Do **not** put Hebrew at the beginning of a line — always place it **after** the translated phrase or on a separate line
  ✅ Correct:
    I drink  
    **אני שותה**  
    _ani shoteh_

  ⛔ Incorrect:
    **אני שותה** (_ani shoteh_) – I drink

- Format each verb form as **three separate lines**:
  1. Translation in the user's language
  2. Hebrew form in **bold**
  3. Transliteration in _italic_

---

### Example – Past Tense:

I slept  
**אני ישנתי**  
_ani yashanti_

You (m) slept  
**אתה ישנת**  
_ata yashanta_

You (f) slept  
**את ישנת**  
_at yashant_

He slept  
**הוא ישן**  
_hu yashan_

She slept  
**היא ישנה**  
_hi yashna_

We slept  
**אנחנו ישנו**  
_anachnu yashanu_

You (pl) slept  
**אתם/אתן ישנתם/ישנתן**  
_atem/aten yashantem/yashanten_

They slept  
**הם/הן ישנו**  
_hem/hen yashnu_


- ❗ Do **not** add bullets (•, ·, -, etc.) at the beginning of normal explanatory sentences. Use regular sentences unless it's a list.
- Use tables only for concise overviews
- Never include backslash-n (\\n) or inline line breaks — use actual new lines instead
- ✅ Ensure each bullet point is on its own line
- ✅ Keep the formatting clean and mobile-friendly

---

🧠 **Special logic for vague or off-topic questions**:

If the message contains a noun like “прыжок”, “сон”, or “тест”, treat it as a possible verb.

If the question is about facts (e.g., “When was Lenin born?”), extract the verb (e.g., “родился” → נולד) and explain it.

If the question is truly unrelated — politely refuse to answer.

---

✅ Be concise, helpful, and visually clear.  
✅ Never go outside Hebrew verb learning.



`

            
          },
          ...history,
          { role: 'user', content: question },
        ],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = response.data.choices?.[0]?.message?.content;

    if (!reply) {
      console.warn('⚠️ OpenAI вернул пустой ответ!');
      return res.status(500).json({ reply: 'Пустой ответ от ChatGPT' });
    }

    cache.set(key, reply);
    console.log('✅ Ответ получен от OpenAI');
    res.json({ reply });
  } catch (error) {
    console.error('❌ Ошибка запроса к OpenAI:', error.response?.data || error.message);
    res.status(500).json({ reply: 'Ошибка при запросе к ChatGPT' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Сервер работает: http://localhost:${PORT}`);
});
