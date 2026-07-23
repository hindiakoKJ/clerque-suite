import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Upload policy for every /import endpoint.
 *
 * Previously FileInterceptor('file') was used with NO options, which meant:
 *   • any file type was accepted (.exe, .zip, anything) and buffered in memory
 *   • there was no size cap at all — a large upload could exhaust the API's
 *     memory (a .xlsx is a zip, so a small "zip bomb" could expand hugely)
 *
 * We accept ONLY the two spreadsheet formats the importer can actually read,
 * and cap the size. Extension is the hard gate (the parser dispatches on it);
 * the MIME list is a secondary check kept deliberately permissive because
 * browsers/OSes report spreadsheet types inconsistently.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_EXTENSIONS = ['xlsx', 'csv'];

const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',   // some browsers send this for .csv/.xls
  'text/csv',
  'application/csv',
  'text/plain',                 // .csv from certain OSes
  'application/octet-stream',   // generic fallback
  '',                           // some clients send no MIME at all
]);

export const IMPORT_UPLOAD: MulterOptions = {
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname?.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(
        new BadRequestException(
          'Only .xlsx or .csv files can be imported. Save your file as Excel (.xlsx) or CSV and try again.',
        ),
        false,
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype ?? '')) {
      return cb(
        new BadRequestException(
          `That file type isn't supported (${file.mimetype}). Save as .xlsx or .csv and try again.`,
        ),
        false,
      );
    }
    return cb(null, true);
  },
};
