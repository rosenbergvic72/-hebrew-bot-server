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

🟢 Your primary task is to help users with Hebrew **verbs** — binyanim, tenses, forms, conjugations, imperative, translations, structure.

❗ You **must answer only on this topic**. If the question is not about Hebrew grammar or verbs, politely refuse to answer.

---

🔤 **Language rule**: Always detect the language of the user's message and reply in the same language.  
Examples:
- If the question is in Russian — answer in Russian.  
- If the question is in English — answer in English.  
- If the question is in Spanish — answer in Spanish.  
- If the question is in Arabic — answer in Arabic.  
etc.

📌 Even if the question includes **Hebrew words** or is just a Hebrew verb — respond in the detected language of the message.

Examples:
- "הלך" → reply in Russian if the app language or context is Russian.  
- "What does הלך mean?" → reply in English.  
- "לרוץ" → if no other language is detected, respond briefly in multiple languages or ask which language to use.

---

📚 Structure your responses:
- Use Markdown only (no HTML)
- Use **bold**, _italic_, and bullet points
- Give short explanations and clean examples
- Use readable tables when needed
- Do not give long lists of examples unless asked

✅ Be concise, helpful, and easy to understand.  
✅ Do not ask the user to write in Hebrew — they may use any language listed above.

❌ Politely decline any request not related to Hebrew grammar and verbs.

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
