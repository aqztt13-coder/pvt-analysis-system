import ExcelJS from 'exceljs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { SystemSettings } from '../shared/types';

export interface ExportTablePayload {
  titleAr: string;
  subtitleAr: string;
  documentCode: string;
  preparedBy: string;
  periodLabel: string;
  columns: Array<{ key: string; header: string; width?: number }>;
  rows: Array<Record<string, string | number | null | undefined>>;
  settings: SystemSettings;
}

export async function generateRtlExcelBuffer(payload: ExportTablePayload): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = payload.preparedBy;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(payload.titleAr.slice(0, 30), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 6 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  const colCount = Math.max(payload.columns.length, 4);

  // Corporate header rows
  sheet.mergeCells(1, 1, 1, colCount);
  const r1 = sheet.getCell(1, 1);
  r1.value = `${payload.settings.companyNameAr} — ${payload.settings.divisionNameAr}`;
  r1.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102638' } };
  r1.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(1).height = 28;

  sheet.mergeCells(2, 1, 2, colCount);
  const r2 = sheet.getCell(2, 1);
  r2.value = payload.titleAr;
  r2.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF17445C' } };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDF2F0' } };
  r2.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(2).height = 24;

  sheet.mergeCells(3, 1, 3, colCount);
  const r3 = sheet.getCell(3, 1);
  r3.value = `رقم الوثيقة: ${payload.documentCode}  |  الفترة: ${payload.periodLabel}  |  أعدّه: ${payload.preparedBy}  |  تاريخ الإصدار: ${new Date().toISOString().slice(0, 10)}`;
  r3.font = { name: 'Arial', size: 10, color: { argb: 'FF233747' } };
  r3.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(3).height = 20;

  sheet.mergeCells(4, 1, 4, colCount);
  const r4 = sheet.getCell(4, 1);
  r4.value = payload.subtitleAr;
  r4.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF718096' } };
  r4.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(4).height = 18;

  // Table header row (row 6)
  const headerRow = sheet.getRow(6);
  payload.columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17445C' } };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFDFE6EC' } },
      bottom: { style: 'medium', color: { argb: 'FFC99A45' } },
      left: { style: 'thin', color: { argb: 'FFDFE6EC' } },
      right: { style: 'thin', color: { argb: 'FFDFE6EC' } },
    };
    sheet.getColumn(idx + 1).width = col.width || 22;
  });
  headerRow.height = 26;

  // Data rows
  payload.rows.forEach((row, rowIdx) => {
    const excelRow = sheet.getRow(7 + rowIdx);
    payload.columns.forEach((col, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      const val = row[col.key];
      cell.value = val === null || val === undefined || val === '' ? '—' : val;
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF233747' } };
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      if (rowIdx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F9' } };
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDFE6EC' } },
        bottom: { style: 'thin', color: { argb: 'FFDFE6EC' } },
        left: { style: 'thin', color: { argb: 'FFDFE6EC' } },
        right: { style: 'thin', color: { argb: 'FFDFE6EC' } },
      };
    });
    excelRow.height = 22;
  });

  // Footer summary row
  const footerIdx = 8 + payload.rows.length;
  sheet.mergeCells(footerIdx, 1, footerIdx, colCount);
  const fCell = sheet.getCell(footerIdx, 1);
  fCell.value = `إجمالي السجلات: ${payload.rows.length}  —  ${payload.settings.reportFooterAr}`;
  fCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF102638' } };
  fCell.alignment = { horizontal: 'right', vertical: 'middle' };

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function generateRtlWordBuffer(payload: ExportTablePayload): Promise<Buffer> {
  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: 'CBD5E1',
  };

  const headerCells = payload.columns.map(
    (col) =>
      new TableCell({
        shading: { fill: '102638' },
        borders: {
          top: borderStyle,
          bottom: borderStyle,
          left: borderStyle,
          right: borderStyle,
        },
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: col.header,
                bold: true,
                color: 'FFFFFF',
                size: 20,
                rightToLeft: true,
                font: 'Arial',
              }),
            ],
          }),
        ],
      })
  );

  const dataRows = payload.rows.map(
    (row, idx) =>
      new TableRow({
        children: payload.columns.map((col) => {
          const val = row[col.key];
          return new TableCell({
            shading: idx % 2 === 1 ? { fill: 'F3F6F9' } : undefined,
            borders: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
            children: [
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: val === null || val === undefined || val === '' ? '—' : String(val),
                    size: 19,
                    color: '233747',
                    rightToLeft: true,
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          });
        }),
      })
  );

  const table = new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: headerCells }), ...dataRows],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: payload.settings.companyNameAr,
                bold: true,
                size: 26,
                color: '102638',
                rightToLeft: true,
                font: 'Arial',
              }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `${payload.settings.divisionNameAr} — ${payload.settings.divisionNameEn}`,
                bold: true,
                size: 22,
                color: '078C8C',
                rightToLeft: true,
                font: 'Arial',
              }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 120 },
            children: [
              new TextRun({
                text: payload.titleAr,
                bold: true,
                size: 28,
                color: '17445C',
                rightToLeft: true,
                font: 'Arial',
              }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: `رقم الوثيقة: ${payload.documentCode}  |  الفترة: ${payload.periodLabel}  |  أعدّه: ${payload.preparedBy}  |  التاريخ: ${new Date().toISOString().slice(0, 10)}`,
                size: 18,
                color: '718096',
                rightToLeft: true,
                font: 'Arial',
              }),
            ],
          }),
          table,
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            spacing: { before: 360, after: 120 },
            children: [
              new TextRun({
                text: `إجمالي السجلات المدرجة: ${payload.rows.length}`,
                bold: true,
                size: 20,
                color: '233747',
                rightToLeft: true,
                font: 'Arial',
              }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            spacing: { before: 300 },
            children: [
              new TextRun({
                text: 'توقيع معدّ التقرير: ________________________          اعتماد مدير الشعبة: ________________________',
                size: 20,
                color: '102638',
                rightToLeft: true,
                font: 'Arial',
              }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            spacing: { before: 240 },
            children: [
              new TextRun({
                text: payload.settings.reportFooterAr,
                size: 16,
                color: '718096',
                rightToLeft: true,
                font: 'Arial',
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
