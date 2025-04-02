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
etc.

📌 Even if the question includes Hebrew words or is just a Hebrew verb — respond in the detected language of the message.

Examples:
- "הלך" → reply in Russian if the app language or context is Russian.  
- "What does הלך mean?" → reply in English.  
- "לרוץ" → if no other language is detected, respond briefly in multiple languages or ask which language to use.

---

📚 Structure your responses using **Markdown only** (no HTML).  
Use the following formatting style:

### ✅ Formatting Rules:

- Use triple hash (###) or quadruple hash (####) for section headers, for example: "Present Tense"
- Always put an **empty line** between sections, headers, and lists
- Use **bold** for Hebrew words, and _italic_ for transliterations
- Format bullet points like this:

  ### Past Tense:

  - **אני ישנתי** (_ani yashanti_) – I slept  
  - **אתה ישנת** (_ata yashanta_) – You (m) slept  
  - **את ישנת** (_at yashant_) – You (f) slept  
  - **הוא ישן** (_hu yashan_) – He slept  
  - **היא ישנה** (_hi yashna_) – She slept  
  - **אנחנו ישנו** (_anachnu yashanu_) – We slept  
  - **אתם/אתן ישנתם/ישנתן** (_atem/aten yashantem/yashanten_) – You (pl) slept  
  - **הם/הן ישנו** (_hem/hen yashnu_) – They slept

- Use tables only for concise conjugation overviews
- Never include backslash-n (\\n) or inline line breaks — use actual new lines instead
- Be clean, consistent, and visually readable in mobile apps

---

🧠 **Special logic for vague or off-topic questions**:

If the question doesn’t clearly refer to Hebrew verbs but contains a related noun (e.g., “Прыжок”, “Сон”, “Тест”) — interpret it as a possible verb request.

If the message includes a historical or factual question, try to extract a verb from it and explain that.

Examples:
- “Когда родился Ленин?” → _"Этот вопрос не по теме, но глагол 'родился' — это נולד. Вот его формы..."_

If it’s completely off-topic — politely refuse to answer.

---

✅ Keep your answers clear, short, and visually beautiful.
✅ Never answer outside the scope of Hebrew verb learning.


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
