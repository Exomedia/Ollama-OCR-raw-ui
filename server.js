import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { ollamaOCR, DEFAULT_OCR_SYSTEM_PROMPT } from 'ollama-ocr';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

const ensureDirectoryExistence = async (filePath) => {
    const dirname = path.dirname(filePath);
    try {
        await fs.mkdir(dirname, { recursive: true });
    } catch (err) {
        console.error(`Failed to create directory ${dirname}:`, err);
        throw new Error(`Error creating directory: ${dirname}`);
    }
};

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const extname = path.extname(file.originalname).toLowerCase();
        const randomName = `${Date.now()}${extname}`;
        cb(null, randomName);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpg|jpeg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Unsupported file type'), false);
        }
    }
});

const generateDocx = async (text, outputPath) => {
    try {
        const doc = new Document({
            sections: [
                {
                    properties: {},
                    children: [
                        new Paragraph({
                            children: [new TextRun(text)],
                        }),
                    ],
                },
            ],
        });

        const buf = await Packer.toBuffer(doc);
        await fs.writeFile(outputPath, buf);
        console.log(`DOCX file created at: ${outputPath}`);
    } catch (error) {
        console.error('Error generating DOCX:', error);
        throw new Error('Error generating DOCX');
    }
};

app.post('/process-ocr', upload.single('imageFile'), async (req, res) => {
    const filePath = req.file.path;
    const outputFileName = `output-${Date.now()}.docx`;
    const outputPath = path.join('downloads', outputFileName);

    try {
        console.log('Uploaded file:', req.file);

        const text = await ollamaOCR({
            filePath: filePath,
            systemPrompt: DEFAULT_OCR_SYSTEM_PROMPT,
        });

        await ensureDirectoryExistence(outputPath);

        await generateDocx(text, outputPath);

        res.json({
            fileUrl: `/downloads/${outputFileName}`
        });

        console.log(`Deleting uploaded file: ${filePath}`);
        await fs.unlink(filePath);

    } catch (error) {
        console.error("Error processing OCR or generating DOCX:", error);
        res.status(500).send("Error processing OCR or generating DOCX.");
    }
});

app.use(express.static('public'));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));


app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});