import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { ollamaOCR, DEFAULT_OCR_SYSTEM_PROMPT } from 'ollama-ocr';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables from .env

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000; // Fallback to 3000 if PORT is not defined
const fileLimit = parseInt(process.env.FILE_LIMIT, 10) || 5; // Default to 5 files

const ensureDirectoryExistence = async (filePath) => {
    const dirname = path.dirname(filePath);
    await fs.mkdir(dirname, { recursive: true });
};

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const extname = path.extname(file.originalname).toLowerCase();
        const randomName = `${Date.now()}-${Math.random().toString(36).substring(2)}${extname}`;
        cb(null, randomName);
    },
});

const upload = multer({
    storage,
    limits: { files: fileLimit },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpg|jpeg|png/;
        const isFileTypeValid = allowedTypes.test(path.extname(file.originalname).toLowerCase()) && 
                                allowedTypes.test(file.mimetype);

        isFileTypeValid ? cb(null, true) : cb(new Error('Unsupported file type'));
    },
}).array('imageFiles', fileLimit);

const generateDocx = async (texts, outputPath) => {
    const paragraphs = texts.map(text => new Paragraph({ children: [new TextRun(text)] }));
    const doc = new Document({
        sections: [{ children: paragraphs }],
    });

    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);
};

app.get('/config', (req, res) => {
    res.json({ fileLimit });
});

app.post('/process-ocr', async (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('File upload error:', err);
            return res.status(400).send(err.message || 'Error uploading files.');
        }

        try {
            const files = req.files;
            const texts = await Promise.all(files.map(async (file) => {
                const text = await ollamaOCR({
                    filePath: file.path,
                    systemPrompt: DEFAULT_OCR_SYSTEM_PROMPT,
                });
                await fs.unlink(file.path); // Clean up uploaded file
                return text;
            }));

            const outputFileName = `output-${Date.now()}.docx`;
            const outputPath = path.join(__dirname, 'downloads', outputFileName);
            await ensureDirectoryExistence(outputPath);
            await generateDocx(texts, outputPath);

            res.json({ fileUrl: `/downloads/${outputFileName}` });
        } catch (error) {
            console.error('Processing error:', error);
            res.status(500).send('Error processing OCR or generating DOCX.');
        }
    });
});

app.use('/downloads', express.static(path.join(__dirname, 'downloads')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
