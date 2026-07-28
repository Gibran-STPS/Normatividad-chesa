#!/usr/bin/env python3
"""Genera un PDF de cumplimiento por unidad de negocio: una portada ejecutiva de una hoja,
lista para firma, seguida del detalle día por colaborador (retardos, faltas, jornadas
excesivas y checadas incompletas) para apoyar la decisión del Gerente General."""
import json, argparse, os, re
from datetime import datetime

MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
         'septiembre','octubre','noviembre','diciembre']
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                 Image, HRFlowable, KeepTogether, PageBreak)
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.utils import ImageReader

AREA_RESPONSABLE = 'Responsable de Auditoria STPS'

GRAPHITE = colors.HexColor('#1C2024')
GREEN = colors.HexColor('#3FA66B')
AMBER = colors.HexColor('#E8A33D')
RED = colors.HexColor('#D1483C')
BLUE = colors.HexColor('#4F8FE0')
INK = colors.HexColor('#21201C')
INK_SOFT = colors.HexColor('#6B675F')
DIVIDER = colors.HexColor('#DEDAD0')
BOXBG = colors.HexColor('#F7F5EF')

plt.rcParams.update({'font.family': 'DejaVu Sans'})

def status_color(pct):
    if pct is None: return AMBER
    if pct >= 85: return GREEN
    if pct >= 59: return AMBER
    return RED

def status_label(pct):
    if pct is None: return 'SIN DATOS'
    if pct >= 85: return 'CUMPLE'
    if pct >= 59: return 'EN RIESGO'
    return 'INCUMPLE'

def niceweek(w):
    if not w: return '—'
    y, wk = w.split('-W')
    return f'Sem {int(wk)} · {y}'

def make_bar_gauge(pct_val, out_path):
    fig, ax = plt.subplots(figsize=(5.4, 0.95))
    ax.set_xlim(0, 100); ax.set_ylim(0, 1); ax.axis('off')
    zones = [(0, 59, '#D1483C'), (59, 85, '#E8A33D'), (85, 100, '#3FA66B')]
    for lo, hi, c in zones:
        ax.axvspan(lo, hi, color=c, ymin=0.32, ymax=0.72, alpha=0.9)
    v = 0 if pct_val is None else max(0, min(100, pct_val))
    ax.axvline(v, color='#1C2024', linewidth=2.6, ymin=0.15, ymax=0.9)
    ax.text(min(max(v, 8), 92), 0.95, f'{v:.1f}%', ha='center', va='bottom', fontsize=13, fontweight='bold', color='#1C2024')
    ax.text(0, 0.05, '0%', ha='left', va='top', fontsize=7, color='#6B675F')
    ax.text(100, 0.05, '100%', ha='right', va='top', fontsize=7, color='#6B675F')
    fig.tight_layout(pad=0.15)
    fig.savefig(out_path, dpi=180, transparent=True)
    plt.close(fig)

def img_dims(path, target_w):
    ir = ImageReader(path)
    w, h = ir.getSize()
    return target_w, target_w * (h / w)

def kpi_box(value, label, accent, w):
    styleNum = ParagraphStyle('num', fontName='Helvetica-Bold', fontSize=18, textColor=INK, leading=20)
    styleLbl = ParagraphStyle('lbl', fontName='Helvetica', fontSize=7.4, textColor=INK_SOFT, leading=8.8)
    t = Table([[Paragraph(str(value), styleNum)], [Paragraph(label, styleLbl)]], colWidths=[w])
    t.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (0, 0), 6), ('BOTTOMPADDING', (0, 0), (0, 0), 1),
        ('BOTTOMPADDING', (0, 1), (0, 1), 6),
        ('LINEBEFORE', (0, 0), (0, -1), 2.4, accent),
        ('BACKGROUND', (0, 0), (-1, -1), BOXBG),
    ]))
    return t

def build_hallazgos(unidad_key, kpis):
    rows = []
    diarios = sorted([r for r in kpis['incidencias']['exceso_diario'] if r['unidad_negocio'] == unidad_key],
                      key=lambda r: -r['horas_trabajadas'])[:3]
    for r in diarios:
        rows.append(['Jornada >12h/día', r['area'][:20], r['nombre'][:26],
                      f"{r['fecha']} · {r['horas_trabajadas']:.1f} h ({r['entrada'] or '—'}–{r['salida'] or '—'})"])
    semanales = sorted([r for r in kpis['incidencias']['exceso_semanal'] if r['unidad_negocio'] == unidad_key],
                        key=lambda r: -r['exceso'])[:3]
    for r in semanales:
        rows.append(['Exceso semanal', r['area'][:20], r['nombre'][:26],
                      f"{niceweek(r['semana_iso'])}: {r['horas_semana']:.1f} h (excede {r['exceso']:.1f} h)"])
    faltas = sorted([r for r in kpis['incidencias']['faltas'] if r['unidad_negocio'] == unidad_key],
                     key=lambda r: -r['total_faltas'])[:2]
    for r in faltas:
        rows.append(['Faltas', (r.get('departamento') or '—')[:20], r['nombre'][:26],
                      f"{r['total_faltas']} días sin checada en el periodo"])
    retardos_list = sorted([r for r in kpis['incidencias']['retardos'] if r['unidad_negocio'] == unidad_key],
                            key=lambda r: -(r['total_6_12'] + r['total_13_24'] + r['total_mas_25']))[:2]
    for r in retardos_list:
        total = r['total_6_12'] + r['total_13_24'] + r['total_mas_25']
        rows.append(['Retardo', (r.get('departamento') or '—')[:20], r['nombre'][:26], f'{total} retardos en el periodo'])
    return rows[:10]

def build_colaborador_roster(unidad_key, dataset):
    roster = {}
    for r in dataset.get('registros_diarios', []):
        if r.get('unidad_negocio') != unidad_key:
            continue
        key = r.get('id_empleado')
        if key not in roster:
            roster[key] = {'id_empleado': key, 'nombre': r.get('nombre') or '', 'area': r.get('area') or '',
                           'dias': 0, 'retardos': 0, 'excesos': 0, 'incompletas': 0, 'faltas': 0}
        e = roster[key]
        e['dias'] += 1
        if r.get('retardo'): e['retardos'] += 1
        if r.get('jornada_excesiva_dia'): e['excesos'] += 1
        if r.get('checada_incompleta'): e['incompletas'] += 1
    for f in dataset.get('faltas_resumen', []):
        if f.get('unidad_negocio') != unidad_key:
            continue
        key = f.get('id_empleado')
        if key not in roster:
            roster[key] = {'id_empleado': key, 'nombre': f.get('nombre') or '', 'area': f.get('departamento') or '',
                           'dias': 0, 'retardos': 0, 'excesos': 0, 'incompletas': 0, 'faltas': 0}
        roster[key]['faltas'] = f.get('total_faltas') or 0
    rows = list(roster.values())
    rows.sort(key=lambda e: -(e['retardos'] + e['excesos'] + e['faltas'] + e['incompletas']))
    return rows

def build_colaborador_table(unidad_key, dataset):
    roster = build_colaborador_roster(unidad_key, dataset)
    styleH = ParagraphStyle('ch', fontName='Helvetica-Bold', fontSize=7.4, textColor=colors.white, leading=9)
    styleB = ParagraphStyle('cb', fontName='Helvetica', fontSize=7.2, textColor=INK, leading=8.6)
    styleBWarn = ParagraphStyle('cbw', fontName='Helvetica-Bold', fontSize=7.2, textColor=RED, leading=8.6)
    header = ['Colaborador', 'Área', 'Días', 'Retardos', 'Faltas', '>12h/día', 'Checada incompleta']
    data = [[Paragraph(h, styleH) for h in header]]
    for e in roster:
        def cell(v, warn):
            return Paragraph(str(v), styleBWarn if (warn and v) else styleB)
        data.append([
            Paragraph((e['nombre'] or '—')[:34], styleB), Paragraph((e['area'] or '—')[:20], styleB),
            cell(e['dias'], False), cell(e['retardos'], True), cell(e['faltas'], True),
            cell(e['excesos'], True), cell(e['incompletas'], True),
        ])
    t = Table(data, colWidths=[5.0*cm, 3.4*cm, 1.5*cm, 2.0*cm, 1.8*cm, 2.0*cm, 3.1*cm], repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), GRAPHITE), ('GRID', (0, 0), (-1, -1), 0.3, DIVIDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ALIGN', (2, 0), (-1, -1), 'CENTER'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BOXBG]),
    ]))
    return t, len(roster)

def unidad_periodo(unidad_key, dataset):
    """Determina el periodo (mes/año) a partir de las fechas reales cargadas para esa unidad —
    no de un valor fijo — para que el reporte refleje automáticamente el mes de los archivos
    que se suban cada vez (abril, mayo, junio…), sin necesidad de tocar el código cada mes."""
    conteo = {}
    for r in dataset.get('registros_diarios', []):
        if r.get('unidad_negocio') != unidad_key or not r.get('fecha'):
            continue
        key = str(r['fecha'])[:7]
        if re.match(r'^\d{4}-\d{2}$', key):
            conteo[key] = conteo.get(key, 0) + 1
    if not conteo:
        for f in dataset.get('faltas_resumen', []):
            if f.get('unidad_negocio') != unidad_key:
                continue
            for fecha in (f.get('fechas') or []):
                key = str(fecha)[:7]
                if re.match(r'^\d{4}-\d{2}$', key):
                    conteo[key] = conteo.get(key, 0) + 1
    anio_ref = dataset.get('anio_referencia', 'S/D')
    if not conteo:
        return {'label': f'Fase {anio_ref}', 'file_tag': f'SD_{anio_ref}'}
    key = max(conteo, key=conteo.get)
    anio, mes_num = key.split('-')
    idx = int(mes_num) - 1
    mes_nombre = MESES[idx] if 0 <= idx < len(MESES) else ''
    mes_cap = mes_nombre.capitalize() if mes_nombre else ''
    return {'label': f'{mes_cap} {anio}'.strip(), 'file_tag': f'{(mes_nombre or "SD").upper()}_{anio}'}

def build_report(unidad_key, kpis, dataset, config, out_path, tmp_dir, logos_dir, firmantes=None):
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle('Eyebrow', fontName='Helvetica-Bold', fontSize=8.3, textColor=AMBER, spaceAfter=2))
    styles.add(ParagraphStyle('H1', fontName='Helvetica-Bold', fontSize=16.5, textColor=INK, spaceAfter=4, leading=19))
    styles.add(ParagraphStyle('H2', fontName='Helvetica-Bold', fontSize=11.5, textColor=INK, spaceBefore=9, spaceAfter=5))
    styles.add(ParagraphStyle('Body', fontName='Helvetica', fontSize=9, textColor=INK, leading=12))
    styles.add(ParagraphStyle('BodySoft', fontName='Helvetica', fontSize=8.4, textColor=INK_SOFT, leading=11))
    styles.add(ParagraphStyle('Sign', fontName='Helvetica', fontSize=8.8, textColor=INK, leading=11.5, alignment=TA_CENTER))
    styles.add(ParagraphStyle('SignRole', fontName='Helvetica-Bold', fontSize=9.3, textColor=INK, leading=11.5, alignment=TA_CENTER))

    unidad = next(u for u in kpis['unidades'] if u['unidad_negocio'] == unidad_key)
    anio = kpis['anio_referencia']
    limite = config['jornada_ordinaria_maxima_semanal_por_anio'][anio]
    tope_extra = config['horas_extra_maximas_semanales_por_anio'][anio]
    calidad = [c for c in kpis['calidad_datos'] if c['unidad_negocio'] == unidad_key]

    gauge_png = os.path.join(tmp_dir, f'{unidad_key}_bargauge.png')
    make_bar_gauge(unidad['pct_cumplimiento_semanal'], gauge_png)

    story = []
    # ---- header ----
    chesa_path = os.path.join(logos_dir, 'chesa.png')
    chesa_w, chesa_h = img_dims(chesa_path, 3.1*cm)
    chesa_img = Image(chesa_path, width=chesa_w, height=chesa_h)
    periodo = unidad_periodo(unidad_key, dataset)
    header_text = [
        Paragraph('CUMPLIMIENTO NORMATIVO · REDUCCIÓN DE JORNADA LABORAL (LFT)', styles['Eyebrow']),
        Paragraph(f'Reporte de Cumplimiento — {unidad_key.replace("_"," ")}', styles['H1']),
        Paragraph(f'Periodo: {periodo["label"]} &nbsp;|&nbsp; '
                  f'Generado: {datetime.now().strftime("%d/%m/%Y")} &nbsp;|&nbsp; Fase {anio}: límite {limite} h/semana',
                  styles['BodySoft']),
    ]
    brand_imgs = []
    marca_key = (unidad.get('marca') or '').strip().lower()
    brand_logo_path = os.path.join(logos_dir, f'{marca_key}.png')
    if os.path.isfile(brand_logo_path):
        bw, bh = img_dims(brand_logo_path, 2.0*cm)
        brand_imgs.append(Image(brand_logo_path, width=bw, height=bh))
    brand_label = Paragraph(f'<b>{(unidad.get("marca") or "").upper()}</b>',
                             ParagraphStyle('BrandLbl', fontName='Helvetica-Bold', fontSize=9.5, textColor=INK,
                                            alignment=TA_CENTER, spaceBefore=4))
    brand_cell = Table([[img] for img in brand_imgs] + [[brand_label]], colWidths=[3.0*cm])
    brand_cell.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER'), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE')]))

    header_tbl = Table([[chesa_img, header_text, brand_cell]], colWidths=[3.4*cm, 12.6*cm, 3.0*cm])
    header_tbl.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ALIGN', (2, 0), (2, 0), 'RIGHT')]))
    story.append(header_tbl)
    story.append(Spacer(1, 3))
    story.append(Paragraph(f'Área responsable: <b>{AREA_RESPONSABLE}</b> — Grupo Chesa (Nissan · Renault · Changan)',
                            styles['BodySoft']))
    story.append(Spacer(1, 5))
    story.append(HRFlowable(width='100%', thickness=1.2, color=GRAPHITE))
    story.append(Spacer(1, 4))

    # ---- marco legal (condensado) ----
    story.append(Paragraph(
        f'<b>Marco legal:</b> Decreto DOF 01/05/2026 (reforma LFT). Jornada ordinaria máxima vigente: <b>{limite} h/semana</b> '
        f'(Art. 59). Tope de horas extra: <b>{tope_extra} h/semana</b> (Art. 66). Límite absoluto diario: <b>12 h</b>, '
        'inexcedible aun pagando tiempo extra (Art. 68). Registro electrónico de jornada obligatorio desde 01/01/2027 '
        '(Art. 132 fracc. XXXIV; multas de 250 a 5,000 UMA). La reducción de jornada no afecta sueldos ni prestaciones '
        '(Transitorio Séptimo).', styles['Body']))
    story.append(Spacer(1, 5))

    # ---- KPI grid + gauge ----
    boxes = [
        kpi_box(unidad['total_colaboradores'], 'COLABORADORES ANALIZADOS', BLUE, 3.75*cm),
        kpi_box(unidad['exceso_diario'], 'JORNADAS >12H/DÍA (ART. 68)', RED, 3.75*cm),
        kpi_box(unidad['checadas_incompletas'], 'CHECADAS INCOMPLETAS', AMBER, 3.75*cm),
        kpi_box(unidad['faltas_total'] if not calidad else f"{unidad['faltas_total']}*", 'FALTAS REGISTRADAS', AMBER, 3.75*cm),
        kpi_box(unidad['retardo_dias'], 'DÍAS-COLABORADOR CON RETARDO', AMBER, 3.75*cm),
        kpi_box(f"{unidad['horas_promedio_colaborador']:.1f} h", 'PROM. HORAS / COLABORADOR', BLUE, 3.75*cm),
        kpi_box(f"{unidad.get('colaboradores_marcaje_completo', 0)}/{unidad['total_colaboradores']}",
                'MARCAJE COMPLETO (4 CHECADAS)', BLUE, 3.75*cm),
    ]
    kpi_grid = Table([boxes[0:3], boxes[3:6], [boxes[6], Spacer(1, 1), Spacer(1, 1)]], colWidths=[3.75*cm]*3)
    kpi_grid.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 2), ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    status = status_label(unidad['pct_cumplimiento_semanal'])
    status_col = status_color(unidad['pct_cumplimiento_semanal'])
    gauge_block = [
        Image(gauge_png, width=6.6*cm, height=6.6*cm*0.176),
        Spacer(1, 2),
        Table([[Paragraph(f'<b>{status}</b>', ParagraphStyle('st', fontName='Helvetica-Bold', fontSize=11, textColor=colors.white, alignment=TA_CENTER))]],
              colWidths=[6.6*cm], style=TableStyle([('BACKGROUND', (0, 0), (-1, -1), status_col),
                                                     ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)])),
    ]
    combo = Table([[kpi_grid, gauge_block]], colWidths=[11.2*cm, 6.9*cm])
    combo.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE')]))
    story.append(combo)
    if calidad:
        story.append(Spacer(1, 3))
        story.append(Paragraph(f'* {calidad[0]["detalle"]}', ParagraphStyle('warn', fontName='Helvetica-Oblique', fontSize=6.8, textColor=RED, leading=8.4)))
    story.append(Spacer(1, 5))

    # ---- hallazgos principales ----
    story.append(Paragraph('Hallazgos principales (muestra representativa — detalle completo en el tablero interactivo y Base_Consolidada_Auditoria.xlsx)', styles['H2']))
    hallazgos = build_hallazgos(unidad_key, kpis)
    if hallazgos:
        styleH = ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=7.6, textColor=colors.white, leading=9)
        styleB = ParagraphStyle('b', fontName='Helvetica', fontSize=7.6, textColor=INK, leading=9.2)
        data = [[Paragraph(h, styleH) for h in ['Tipo', 'Área', 'Colaborador', 'Detalle']]] + \
               [[Paragraph(str(c), styleB) for c in row] for row in hallazgos]
        t = Table(data, colWidths=[2.7*cm, 3.3*cm, 5.2*cm, 6.9*cm], repeatRows=1)
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), GRAPHITE), ('GRID', (0, 0), (-1, -1), 0.4, DIVIDER),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('TOPPADDING', (0, 0), (-1, -1), 2.2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.2),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BOXBG]),
        ]))
        story.append(t)
    else:
        story.append(Paragraph('Sin incidencias relevantes registradas en este periodo. ✓', styles['Body']))
    story.append(Spacer(1, 5))

    # ---- recomendación condensada ----
    recos = []
    if unidad['exceso_diario'] > 0:
        recos.append(f"revisar de inmediato los {unidad['exceso_diario']} casos de jornada &gt;12h/día (Art. 68, tope inexcedible)")
    if unidad['pct_cumplimiento_semanal'] is not None and unidad['pct_cumplimiento_semanal'] < 85:
        recos.append(f"rediseñar turnos antes de la reducción a {config['jornada_ordinaria_maxima_semanal_por_anio'].get(str(int(anio)+1), '—')} h/semana en {int(anio)+1}")
    if unidad['checadas_incompletas'] > 0:
        recos.append('reforzar la disciplina de checado ante la obligatoriedad del registro electrónico en 2027')
    if not recos:
        recos.append('la unidad se mantiene dentro de los parámetros normativos evaluados; continuar el monitoreo mensual')
    story.append(Paragraph('<b>Recomendación:</b> ' + '; '.join(recos) + '.', styles['Body']))
    story.append(Spacer(1, 8))

    # ---- firmas (en la primera hoja, como siempre) ----
    firmantes = firmantes or {}
    hoy = datetime.now().strftime('%d / %m / %Y')
    nombre_row, fecha_row = [], []
    for rol_key in ('elabora', 'recibe', 'vobo'):
        nombre = (firmantes.get(rol_key) or '').strip()
        if nombre:
            nombre_row.append(Paragraph(f'<b>{nombre}</b> — Nombre capturado, firma:', styles['BodySoft']))
            fecha_row.append(Paragraph(f'Fecha: {hoy}', styles['BodySoft']))
        else:
            nombre_row.append(Paragraph('Nombre y firma', styles['BodySoft']))
            fecha_row.append(Paragraph('Fecha: ____ / ____ / 2026', styles['BodySoft']))
    sign_row = [
        [Paragraph('_______________________________', styles['Sign'])]*3,
        [Paragraph('ELABORA', styles['SignRole']), Paragraph('RECIBE', styles['SignRole']), Paragraph('VISTO BUENO', styles['SignRole'])],
        [Paragraph(f'<b>{AREA_RESPONSABLE}</b>', styles['Sign']),
         Paragraph('<b>Gerente General</b>', styles['Sign']),
         Paragraph('<b>Dirección de Talento Humano</b>', styles['Sign'])],
        nombre_row,
        fecha_row,
    ]
    sign_table = Table(sign_row, colWidths=[6.8*cm]*3)
    sign_table.setStyle(TableStyle([('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                                     ('ALIGN', (0, 0), (-1, -1), 'CENTER')]))
    story.append(KeepTogether([
        HRFlowable(width='100%', thickness=0.7, color=DIVIDER),
        Spacer(1, 10),
        sign_table,
    ]))

    # ---- anexo: detalle por colaborador (página aparte, después de las firmas) ----
    story.append(PageBreak())
    story.append(Paragraph('CUMPLIMIENTO NORMATIVO · REDUCCIÓN DE JORNADA LABORAL (LFT)', styles['Eyebrow']))
    story.append(Paragraph(f'Anexo — Detalle por colaborador — {unidad_key.replace("_"," ")}', styles['H1']))
    story.append(Paragraph(
        'Situación individual del periodo: retardos, días sin checada (faltas), jornadas que exceden el límite '
        f'diario de 12 horas (Art. 68 LFT) y checadas incompletas. Ordenado de mayor a menor incidencia, para '
        'apoyar la decisión del Gerente General sobre qué casos atender primero.', styles['BodySoft']))
    story.append(Spacer(1, 6))
    colab_table, n_colab = build_colaborador_table(unidad_key, dataset)
    story.append(colab_table)
    story.append(Spacer(1, 4))
    story.append(Paragraph(f'{n_colab} colaborador(es) con registro en el periodo.',
                            ParagraphStyle('note', fontName='Helvetica-Oblique', fontSize=7, textColor=INK_SOFT)))
    story.append(Spacer(1, 12))


    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 6.8)
        canvas.setFillColor(INK_SOFT)
        canvas.drawString(1.3*cm, 1.0*cm,
            f'Elaborado por {AREA_RESPONSABLE} · Grupo Chesa · Decreto DOF 01/05/2026 (reforma LFT, jornada laboral)')
        canvas.drawRightString(20.24*cm, 1.0*cm, f'Página {canvas.getPageNumber()} · sin asesoría legal')
        canvas.restoreState()

    doc = SimpleDocTemplate(out_path, pagesize=letter,
                             topMargin=1.15*cm, bottomMargin=1.3*cm, leftMargin=1.3*cm, rightMargin=1.3*cm,
                             title=f'Reporte de Cumplimiento - {unidad_key}')
    doc.build(story, onFirstPage=footer, onLaterPages=footer)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kpis', required=True)
    ap.add_argument('--dataset', required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--logos-dir', default=None)
    ap.add_argument('--elabora', default=None, help='Nombre de quien elabora (opcional; si se omite, el PDF deja el espacio en blanco para firmar a mano)')
    ap.add_argument('--recibe', default=None, help='Nombre de quien recibe (opcional)')
    ap.add_argument('--vobo', default=None, help='Nombre de quien da el visto bueno (opcional)')
    args = ap.parse_args()
    with open(args.kpis, encoding='utf-8') as f:
        kpis = json.load(f)
    with open(args.dataset, encoding='utf-8') as f:
        dataset = json.load(f)
    config = kpis['normativa']
    os.makedirs(args.out_dir, exist_ok=True)
    tmp_dir = '/home/claude/proyecto/charts_tmp'
    os.makedirs(tmp_dir, exist_ok=True)
    logos_dir = args.logos_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logos')
    firmantes = {'elabora': args.elabora, 'recibe': args.recibe, 'vobo': args.vobo}
    bitacora_rows = []
    for u in kpis['unidades']:
        key = u['unidad_negocio']
        periodo = unidad_periodo(key, dataset)
        out_path = os.path.join(args.out_dir, f'Reporte_Cumplimiento_{key}_{periodo["file_tag"]}.pdf')
        build_report(key, kpis, dataset, config, out_path, tmp_dir, logos_dir, firmantes=firmantes)
        pages = 1
        try:
            import pypdf
            pages = len(pypdf.PdfReader(out_path).pages)
        except Exception:
            pass
        print('OK', out_path, f'({pages} pagina(s))')
        bitacora_rows.append({
            'unidad': key, 'fecha_generacion': datetime.now().isoformat(),
            'elabora': args.elabora or '', 'recibe': args.recibe or '', 'vobo': args.vobo or '',
        })

    bitacora_path = os.path.join(args.out_dir, 'bitacora_firmas.csv')
    with open(bitacora_path, 'w', encoding='utf-8') as f:
        f.write('Unidad,Generado,Elabora,Recibe,Visto Bueno\n')
        for r in bitacora_rows:
            f.write(f"{r['unidad']},{r['fecha_generacion']},{r['elabora']},{r['recibe']},{r['vobo']}\n")
    print('Bitácora de firmas escrita en', bitacora_path)

if __name__ == '__main__':
    main()
