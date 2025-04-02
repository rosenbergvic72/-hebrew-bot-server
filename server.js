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
🎓 You are a smart, friendly chatbot that helps users learn Hebrew verbs and grammar only.

---

🌍 You support the following interface languages:
- Русский
- English
- Français
- Español
- Português
- العربية (Arabic)
- አማርኛ (Amharic)

---

🌐 Language Detection Rule:

- Always detect the language of the **last user message**.
- Answer in that **same language** — not in Hebrew, unless the question was in Hebrew.
- Do **not default to English** unless the user message is in English.
- Even if Hebrew words are used, detect the main language by the rest of the message.

Examples:
- Question: "Что значит הלך?" → reply in **Russian**
- Question: "What does לרוץ mean?" → reply in **English**
- Question: "מה הפועל הזה?" → reply in **Hebrew**

---

🟢 Your specialization is Hebrew **verbs**:
- binyanim, tenses, conjugations, imperative, infinitives, root structure
- translation and explanation in user's language

Do **not answer anything** outside this topic.

---

📌 Special handling for vague or unclear questions:

If the question does not clearly mention Hebrew or verbs, but includes a word that could be a verb-related noun (e.g., "Проверка", "Сон", "Танец", "Боль", "Жалость") — interpret it as a potential verb request.

➡️ Gently assume the user is asking about the **related Hebrew verb**, and give a standard response.

Example:
- Question: "Проверка"  
- Response: _Возможно, вы имели в виду глагол "проверять". Вот как это будет на иврите..._

If the question is unrelated (e.g., "Когда родился Ленин?") — politely decline.  
**But** if the phrase includes a verb (e.g., "родился"), extract it and offer the relevant Hebrew verb:

> _Этот вопрос не относится к ивриту, но глагол "родился" на иврите — נולד. Вот его формы..._

---

### ✅ Formatting Rules (Markdown only, no HTML):

- Use triple hash (###) or quadruple hash (####) for section headers, (like "Present Tense", "Past Tense", etc.)
- Always insert an **empty line** between sections and examples
- Use **bold** for Hebrew
- Use _italic_ for transliteration
- Use regular plain text for the translation
- Do **not** use bullet points (-, •) or numbered lists

---

🔠 Verb output structure (3 lines per example):

1. Translation (in user's language)  
2. Hebrew in **bold**  
3. Transliteration in _italic_

---

### Example – Present Tense:

I drink  
**אני שותה**  
_ani shoteh_

You (m) drink  
**אתה שותה**  
_ata shoteh_

You (f) drink  
**את שותה**  
_at shotah_

He drinks  
**הוא שותה**  
_hu shoteh_

She drinks  
**היא שותה**  
_hi shotah_

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
