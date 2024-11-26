import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { ollamaOCR, DEFAULT_OCR_SYSTEM_PROMPT } from 'ollama-ocr';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
    port: process.env.PORT || 3000,
    fileLimit: parseInt(process.env.FILE_LIMIT, 10) || 5,
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
    downloadDir: process.env.DOWNLOAD_DIR || path.join(__dirname, 'downloads'),
};

if (!process.env.FILE_LIMIT || isNaN(config.fileLimit)) {
    throw new Error('FILE_LIMIT is not properly set in .env');
}

const app = express();

const ensureDirectoryExistence = async (filePath) => {
    const dirname = path.dirname(filePath);
    await fs.mkdir(dirname, { recursive: true });
};

const storage = multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => {
        const extname = path.extname(file.originalname).toLowerCase();
        const randomName = `${Date.now()}-${Math.random().toString(36).substring(2)}${extname}`;
        cb(null, randomName);
    },
});

const upload = multer({
    storage,
    limits: { files: config.fileLimit, fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpg|jpeg|png/;
        const isFileTypeValid = allowedTypes.test(path.extname(file.originalname).toLowerCase()) && 
                                allowedTypes.test(file.mimetype);

        isFileTypeValid ? cb(null, true) : cb(new Error('Unsupported file type'));
    },
}).array('imageFiles', config.fileLimit);

const generateDocx = async (texts, outputPath) => {
    const paragraphs = texts.map(text => new Paragraph({ children: [new TextRun(text)] }));
    const doc = new Document({
        sections: [{ children: paragraphs }],
    });

    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);
};

app.get('/config', (req, res) => {
    res.json({ fileLimit: config.fileLimit });
});

app.post('/process-ocr', async (req, res, next) => {
    upload(req, res, async (err) => {
        if (err) return next(err);

        try {
            const files = req.files;
            const texts = await Promise.all(files.map(async (file) => {
                const text = await ollamaOCR({ filePath: file.path, systemPrompt: DEFAULT_OCR_SYSTEM_PROMPT });
                await fs.unlink(file.path);
                return text;
            }));

            const outputFileName = `output-${Date.now()}.docx`;
            const outputPath = path.join(config.downloadDir, outputFileName);
            await ensureDirectoryExistence(outputPath);
            await generateDocx(texts, outputPath);

            res.json({ fileUrl: `/downloads/${outputFileName}` });
        } catch (error) {
            next(error);
        }
    });
});

app.use('/downloads', express.static(config.downloadDir, {
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
});
