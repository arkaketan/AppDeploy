const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const pdfParse   = require('pdf-parse');
const mammoth    = require('mammoth');
const axios      = require('axios');

const app  = express();
const port = 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

async function extractText(file) {
  const ext      = path.extname(file.originalname).toLowerCase();
  const filePath = file.path;

  if (ext === '.txt') {
    return fs.promises.readFile(filePath, 'utf-8');
  }
  if (ext === '.pdf') {
    const buffer = await fs.promises.readFile(filePath);
    const data   = await pdfParse(buffer);
    return data.text;
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

app.post(
  '/api/tailor-resume',
  upload.fields([{ name: 'resume' }, { name: 'jobdesc' }]),
  async (req, res) => {
    try {
      const apiKey = req.headers['x-openai-key'];
      if (!apiKey) {
        return res.status(401).json({ error: 'Missing OpenRouter API key' });
      }

      const resumeFile    = req.files['resume']?.[0];
      const jobFile       = req.files['jobdesc']?.[0];
      const jdText        = req.body.jdText || '';
      const refinePrompt  = req.body.refinePrompt || '';

      if (!resumeFile) {
        return res.status(400).json({ error: 'No resume file uploaded.' });
      }

      const resumeText = await extractText(resumeFile);
      const jobText    = jobFile ? await extractText(jobFile) : jdText;
      if (!jobText) {
        return res.status(400).json({ error: 'No job description provided.' });
      }

      // Build the user message with guarantee of 3+ bullets & any refinement
      let userContent = `
Here is the resume:
${resumeText}

Here is the job description:
${jobText}

Please output at least three bullet points (each starting with "-") tailoring the resume to the JD.
`;
      if (refinePrompt) {
        userContent += `\nAdditional instructions:\n${refinePrompt}\n`;
      }

      const completion = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'openai/gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content:
                'You are an expert resume tailoring assistant helping job seekers match their resumes to job descriptions.'
            },
            {
              role: 'user',
              content: userContent.trim()
            }
          ],
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const tailored = completion.data.choices[0].message.content;
      res.json({ tailored });

      // cleanup
      fs.unlinkSync(resumeFile.path);
      if (jobFile) fs.unlinkSync(jobFile.path);
    } catch (err) {
      console.error('❌ Backend Error:', err.response?.data || err.message);
      res.status(500).json({
        error: err.response?.data?.error || err.message || 'Internal Server Error'
      });
    }
  }
);

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
