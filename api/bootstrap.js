const {turso,rowsFrom,modernHash}=require('../lib/auth');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    clave_hash TEXT NOT NULL,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('J','A','O')),
    cargo TEXT,
    telefono TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    creado TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS centros (
    codigo TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    municipio TEXT,
    parroquia TEXT,
    estado TEXT,
    mesas INTEGER DEFAULT 1,
    cod_estado TEXT,
    cod_municipio TEXT,
    cod_parroquia TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS padron (
    cedula TEXT PRIMARY KEY,
    letra TEXT NOT NULL DEFAULT 'V',
    p_apellido TEXT,
    s_apellido TEXT,
    p_nombre TEXT,
    s_nombre TEXT,
    sexo TEXT CHECK(sexo IN ('M','F')),
    fecha_nac TEXT,
    edad INTEGER,
    codigo_estado TEXT,
    estado TEXT,
    codigo_municipio TEXT,
    municipio TEXT,
    codigo_parroquia TEXT,
    parroquia TEXT,
    centro_votacion TEXT,
    nombre_cv TEXT,
    es_manual INTEGER DEFAULT 0,
    creado TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS reclutadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cedula TEXT NOT NULL UNIQUE,
    telefono TEXT,
    estructura TEXT,
    direccion TEXT,
    creado TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS asignaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reclutador_id INTEGER NOT NULL,
    cedula TEXT NOT NULL UNIQUE,
    posicion INTEGER,
    telefono TEXT,
    registrado_en TEXT DEFAULT (datetime('now')),
    numero_calle TEXT,
    numero_casa TEXT,
    direccion TEXT,
    FOREIGN KEY (reclutador_id) REFERENCES reclutadores(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS actividad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT,
    texto TEXT,
    usuario_id INTEGER,
    creado TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS centro_cargos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    centro_codigo TEXT NOT NULL,
    cargo TEXT NOT NULL,
    cedula TEXT,
    telefono TEXT,
    direccion TEXT,
    asignado_en TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (centro_codigo) REFERENCES centros(codigo) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pad_centro ON padron(centro_votacion)`,
  `CREATE INDEX IF NOT EXISTS idx_pad_mun ON padron(municipio)`,
  `CREATE INDEX IF NOT EXISTS idx_asig_recl ON asignaciones(reclutador_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cargo_centro ON centro_cargos(centro_codigo)`,
  `ALTER TABLE asignaciones ADD COLUMN telefono TEXT`,
  `ALTER TABLE asignaciones ADD COLUMN numero_calle TEXT`,
  `ALTER TABLE asignaciones ADD COLUMN numero_casa TEXT`,
  `ALTER TABLE asignaciones ADD COLUMN direccion TEXT`,
  `ALTER TABLE reclutadores ADD COLUMN direccion TEXT`,
  `ALTER TABLE centro_cargos ADD COLUMN telefono TEXT`,
  `ALTER TABLE centro_cargos ADD COLUMN direccion TEXT`,
  `CREATE TABLE IF NOT EXISTS direccion_ejecutiva (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cargo TEXT NOT NULL,
    cedula TEXT NOT NULL UNIQUE,
    nombre TEXT,
    telefono TEXT,
    estructura TEXT,
    direccion TEXT,
    creado TEXT DEFAULT (datetime('now'))
  )`,
  `ALTER TABLE direccion_ejecutiva ADD COLUMN nombre TEXT`,
  `ALTER TABLE direccion_ejecutiva ADD COLUMN telefono TEXT`,
  `ALTER TABLE direccion_ejecutiva ADD COLUMN estructura TEXT`,
  `ALTER TABLE direccion_ejecutiva ADD COLUMN direccion TEXT`,
  `ALTER TABLE direccion_ejecutiva ADD COLUMN creado TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_dir_cargo ON direccion_ejecutiva(cargo)`,
  `CREATE TABLE IF NOT EXISTS comite_vecinal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comunidad TEXT NOT NULL,
    cargo TEXT NOT NULL DEFAULT 'COORDINADOR',
    cedula TEXT NOT NULL UNIQUE,
    nombre TEXT,
    telefono TEXT,
    direccion TEXT,
    numero_calle TEXT,
    numero_casa TEXT,
    problematica_actual TEXT,
    creado TEXT DEFAULT (datetime('now'))
  )`,
  `ALTER TABLE comite_vecinal ADD COLUMN comunidad TEXT`,
  `ALTER TABLE comite_vecinal ADD COLUMN nombre TEXT`,
  `ALTER TABLE comite_vecinal ADD COLUMN telefono TEXT`,
  `ALTER TABLE comite_vecinal ADD COLUMN direccion TEXT`,
  `ALTER TABLE comite_vecinal ADD COLUMN numero_calle TEXT`,
  `ALTER TABLE comite_vecinal ADD COLUMN numero_casa TEXT`,
  `ALTER TABLE comite_vecinal ADD COLUMN problematica_actual TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_comite_comunidad ON comite_vecinal(comunidad)`,
  `CREATE TABLE IF NOT EXISTS catalogo_problemas (id INTEGER PRIMARY KEY AUTOINCREMENT, categoria TEXT NOT NULL, nombre TEXT NOT NULL UNIQUE, activo INTEGER NOT NULL DEFAULT 1, orden INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS comite_problemas (comite_id INTEGER NOT NULL, problema_id INTEGER NOT NULL, PRIMARY KEY(comite_id, problema_id), FOREIGN KEY(comite_id) REFERENCES comite_vecinal(id) ON DELETE CASCADE, FOREIGN KEY(problema_id) REFERENCES catalogo_problemas(id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS idx_cp_problema ON comite_problemas(problema_id)`,
  `CREATE TABLE IF NOT EXISTS verificaciones_votacion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cedula TEXT NOT NULL UNIQUE,
    centro_codigo TEXT NOT NULL,
    mesa TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'VOTO_VERIFICADO' CHECK(estado IN ('VOTO_VERIFICADO')),
    verificado_en TEXT NOT NULL DEFAULT (datetime('now')),
    verificado_por INTEGER,
    FOREIGN KEY(centro_codigo) REFERENCES centros(codigo) ON DELETE CASCADE,
    FOREIGN KEY(verificado_por) REFERENCES usuarios(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_verif_centro ON verificaciones_votacion(centro_codigo)`,
  `CREATE INDEX IF NOT EXISTS idx_verif_mesa ON verificaciones_votacion(centro_codigo, mesa)`,
  `CREATE TABLE IF NOT EXISTS actas_mesa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    centro_codigo TEXT NOT NULL,
    mesa TEXT NOT NULL,
    cantidad_acta INTEGER NOT NULL DEFAULT 0 CHECK(cantidad_acta >= 0),
    votos_partido INTEGER NOT NULL DEFAULT 0 CHECK(votos_partido >= 0),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado_por INTEGER,
    UNIQUE(centro_codigo, mesa),
    FOREIGN KEY(centro_codigo) REFERENCES centros(codigo) ON DELETE CASCADE,
    FOREIGN KEY(actualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_actas_centro ON actas_mesa(centro_codigo)`,
  `CREATE TABLE IF NOT EXISTS mesa_operativa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    centro_codigo TEXT NOT NULL,
    mesa TEXT NOT NULL,
    hora_constitucion TEXT,
    hora_inicio_votacion TEXT,
    testigos_asistieron INTEGER NOT NULL DEFAULT 0 CHECK(testigos_asistieron >= 0),
    estado_maquina TEXT NOT NULL DEFAULT 'OPERATIVA' CHECK(estado_maquina IN ('OPERATIVA','DEFECTUOSA','DAÑADA','EN REPARACIÓN','REEMPLAZADA','OTRO')),
    observacion_maquina TEXT,
    estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK(estado IN ('ABIERTA','CERRADA')),
    hora_cierre TEXT,
    cierre_por INTEGER,
    resultados_cierre_json TEXT,
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado_por INTEGER,
    UNIQUE(centro_codigo, mesa),
    FOREIGN KEY(centro_codigo) REFERENCES centros(codigo) ON DELETE CASCADE,
    FOREIGN KEY(actualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL
  )`,
  `ALTER TABLE mesa_operativa ADD COLUMN estado_maquina TEXT NOT NULL DEFAULT 'OPERATIVA'`,
  `ALTER TABLE mesa_operativa ADD COLUMN observacion_maquina TEXT`,
  `ALTER TABLE mesa_operativa ADD COLUMN estado TEXT NOT NULL DEFAULT 'ABIERTA'`,
  `ALTER TABLE mesa_operativa ADD COLUMN hora_cierre TEXT`,
  `ALTER TABLE mesa_operativa ADD COLUMN cierre_por INTEGER`,
  `ALTER TABLE mesa_operativa ADD COLUMN resultados_cierre_json TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_mesa_operativa_centro ON mesa_operativa(centro_codigo)`,
  `CREATE TABLE IF NOT EXISTS mesa_maquina_historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_operativa_id INTEGER NOT NULL,
    estado_anterior TEXT,
    estado_nuevo TEXT NOT NULL CHECK(estado_nuevo IN ('OPERATIVA','DEFECTUOSA','DAÑADA','EN REPARACIÓN','REEMPLAZADA','OTRO')),
    observacion TEXT,
    cambiado_en TEXT NOT NULL DEFAULT (datetime('now')),
    cambiado_por INTEGER,
    FOREIGN KEY(mesa_operativa_id) REFERENCES mesa_operativa(id) ON DELETE CASCADE,
    FOREIGN KEY(cambiado_por) REFERENCES usuarios(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mesa_maquina_hist_mesa ON mesa_maquina_historial(mesa_operativa_id, cambiado_en)`,
  `CREATE TABLE IF NOT EXISTS mesa_miembros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_operativa_id INTEGER NOT NULL,
    cedula TEXT NOT NULL,
    cargo TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('AFECTO','ACCIDENTAL')),
    origen TEXT,
    autorizado INTEGER NOT NULL DEFAULT 0 CHECK(autorizado IN (0,1)),
    autorizado_por INTEGER,
    autorizado_en TEXT,
    registrado_en TEXT NOT NULL DEFAULT (datetime('now')),
    registrado_por INTEGER,
    UNIQUE(mesa_operativa_id, cedula, cargo, tipo),
    FOREIGN KEY(mesa_operativa_id) REFERENCES mesa_operativa(id) ON DELETE CASCADE,
    FOREIGN KEY(autorizado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
    FOREIGN KEY(registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mesa_miembros_mesa ON mesa_miembros(mesa_operativa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mesa_miembros_ci ON mesa_miembros(cedula)`,
  `CREATE TABLE IF NOT EXISTS cortes_electorales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    centro_codigo TEXT NOT NULL,
    etiqueta TEXT,
    tomado_en TEXT NOT NULL DEFAULT (datetime('now')),
    tomado_por INTEGER,
    personas_universo INTEGER NOT NULL DEFAULT 0,
    verificados INTEGER NOT NULL DEFAULT 0,
    pendientes INTEGER NOT NULL DEFAULT 0,
    porcentaje_verificado REAL NOT NULL DEFAULT 0,
    masculinos_universo INTEGER NOT NULL DEFAULT 0,
    femeninos_universo INTEGER NOT NULL DEFAULT 0,
    masculinos_verificados INTEGER NOT NULL DEFAULT 0,
    femeninos_verificados INTEGER NOT NULL DEFAULT 0,
    mesas_total INTEGER NOT NULL DEFAULT 0,
    mesas_con_acta INTEGER NOT NULL DEFAULT 0,
    votos_partido_acta INTEGER NOT NULL DEFAULT 0,
    diferencia_acta INTEGER,
    detalle_json TEXT,
    FOREIGN KEY(centro_codigo) REFERENCES centros(codigo) ON DELETE CASCADE,
    FOREIGN KEY(tomado_por) REFERENCES usuarios(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cortes_centro_fecha ON cortes_electorales(centro_codigo, tomado_en DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cortes_fecha ON cortes_electorales(tomado_en DESC)`,
  `CREATE TABLE IF NOT EXISTS autorizaciones_duplicidad_persona (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cedula TEXT NOT NULL,
    contexto_origen TEXT NOT NULL,
    contexto_destino TEXT NOT NULL,
    detalle_duplicidad TEXT,
    motivo TEXT NOT NULL,
    autorizado_por INTEGER NOT NULL,
    autorizado_en TEXT NOT NULL DEFAULT (datetime('now')),
    registrado_por INTEGER,
    FOREIGN KEY(autorizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
    FOREIGN KEY(registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_aut_dup_cedula ON autorizaciones_duplicidad_persona(cedula)`,
  `CREATE INDEX IF NOT EXISTS idx_aut_dup_fecha ON autorizaciones_duplicidad_persona(autorizado_en DESC)`,
  `ALTER TABLE autorizaciones_duplicidad_persona ADD COLUMN destino_detalle TEXT`,
  `ALTER TABLE autorizaciones_duplicidad_persona ADD COLUMN consumida_en TEXT`,
  `ALTER TABLE autorizaciones_duplicidad_persona ADD COLUMN consumida_por INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_aut_dup_disponible ON autorizaciones_duplicidad_persona(cedula, contexto_destino, consumida_en)`,
];;

const PROBLEMAS = [
  ['Servicios públicos','Agua potable'],
  ['Servicios públicos','Aguas servidas / cloacas'],
  ['Servicios públicos','Recolección de basura'],
  ['Servicios públicos','Alumbrado público'],
  ['Servicios públicos','Electricidad'],
  ['Servicios públicos','Gas doméstico'],
  ['Servicios públicos','Transporte público'],
  ['Infraestructura','Vialidad / calles'],
  ['Infraestructura','Aceras / brocales'],
  ['Infraestructura','Drenajes / aguas de lluvia'],
  ['Infraestructura','Puentes / accesos'],
  ['Infraestructura','Espacios públicos'],
  ['Vivienda','Déficit o deterioro de vivienda'],
  ['Vivienda','Techo / filtraciones'],
  ['Vivienda','Hacinamiento'],
  ['Salud','Atención médica'],
  ['Salud','Medicamentos'],
  ['Salud','Ambulatorio / centro de salud'],
  ['Educación','Infraestructura educativa'],
  ['Educación','Acceso a educación'],
  ['Educación','Materiales escolares'],
  ['Seguridad','Seguridad ciudadana'],
  ['Seguridad','Iluminación de zonas de riesgo'],
  ['Ambiente','Contaminación'],
  ['Ambiente','Áreas verdes'],
  ['Ambiente','Animales en situación de calle'],
  ['Conectividad','Telefonía / señal móvil'],
  ['Conectividad','Internet'],
  ['Cultura y deporte','Canchas deportivas'],
  ['Cultura y deporte','Actividades culturales / comunitarias'],
  ['Social','Adultos mayores'],
  ['Social','Personas con discapacidad'],
  ['Social','Alimentación'],
  ['Social','Empleo / emprendimiento'],
  ['Otros','Otro problema comunitario']
];;

const isBenign = e => /duplicate column name|already exists|duplicate index|duplicate table|no such column/i.test(String(e?.message||e||'').toLowerCase());

async function migrateComiteRoles(){
  const cols=rowsFrom(await turso([{q:'PRAGMA table_info(comite_vecinal)',params:[]}]));
  if(!cols.length)return;
  if(!cols.some(x=>x.name==='cargo')) await turso([{q:"ALTER TABLE comite_vecinal ADD COLUMN cargo TEXT NOT NULL DEFAULT 'COORDINADOR'",params:[]}]);
  const indexes=rowsFrom(await turso([{q:'PRAGMA index_list(comite_vecinal)',params:[]}]));
  let cedulaUnique=false;
  for(const ix of indexes){
    if(!ix.unique)continue;
    const info=rowsFrom(await turso([{q:"PRAGMA index_info('"+String(ix.name).replace(/'/g,"''")+"')",params:[]}]));
    if(info.length===1&&info[0].name==='cedula'){cedulaUnique=true;break;}
  }
  if(!cedulaUnique){
    await turso([{q:'CREATE INDEX IF NOT EXISTS idx_comite_comunidad ON comite_vecinal(comunidad)',params:[]}]);
    await turso([{q:'CREATE INDEX IF NOT EXISTS idx_comite_cargo ON comite_vecinal(cargo)',params:[]}]);
    await turso([{q:'CREATE UNIQUE INDEX IF NOT EXISTS ux_comite_comunidad_cargo ON comite_vecinal(comunidad,cargo)',params:[]}]);
    return;
  }

  // Nunca descartar silenciosamente registros durante la migración.
  await turso([{q:`CREATE TABLE IF NOT EXISTS comite_vecinal_legacy_backup (
    backup_id INTEGER PRIMARY KEY AUTOINCREMENT,
    backed_up_at TEXT NOT NULL DEFAULT (datetime('now')),
    legacy_id INTEGER,
    comunidad TEXT,
    cargo TEXT,
    cedula TEXT,
    nombre TEXT,
    telefono TEXT,
    direccion TEXT,
    numero_calle TEXT,
    numero_casa TEXT,
    problematica_actual TEXT,
    creado TEXT
  )`,params:[]}]);
  await turso([{q:`INSERT INTO comite_vecinal_legacy_backup(legacy_id,comunidad,cargo,cedula,nombre,telefono,direccion,numero_calle,numero_casa,problematica_actual,creado)
    SELECT id,comunidad,COALESCE(NULLIF(cargo,''),'COORDINADOR'),cedula,nombre,telefono,direccion,numero_calle,numero_casa,problematica_actual,creado FROM comite_vecinal`,params:[]}]);

  const legacy=rowsFrom(await turso([{q:`SELECT id,comunidad,COALESCE(NULLIF(cargo,''),'') AS cargo,cedula,nombre,telefono,direccion,numero_calle,numero_casa,problematica_actual,creado
    FROM comite_vecinal ORDER BY comunidad,id`,params:[]}])));
  const allowed=['COORDINADOR','RESPONSABLE DE ORGANIZACIÓN','RESPONSABLE ELECTORAL','RESPONSABLE DE JUVENTUD','RESPONSABLE DE ACCIÓN SOCIAL'];
  const grouped=new Map();
  for(const row of legacy){ const key=String(row.comunidad||'').trim(); if(!grouped.has(key))grouped.set(key,[]); grouped.get(key).push(row); }
  for(const [comunidad,rows] of grouped){
    const used=new Set();
    for(const row of rows){ if(allowed.includes(row.cargo)&&!used.has(row.cargo))used.add(row.cargo); }
    const assignments=[];
    for(const row of rows){
      let cargo=allowed.includes(row.cargo)&&!assignments.some(x=>x.cargo===row.cargo) ? row.cargo : allowed.find(x=>!used.has(x));
      if(!cargo) throw new Error('Migración de Comité Vecinal requiere revisión: la comunidad "'+comunidad+'" tiene más de cinco registros. Los datos originales fueron respaldados en comite_vecinal_legacy_backup.');
      used.add(cargo); assignments.push({...row,cargo});
    }
    rowAssignments.push(...assignments);
  }

  await turso([{q:`CREATE TABLE comite_vecinal_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comunidad TEXT NOT NULL,
    cargo TEXT NOT NULL,
    cedula TEXT NOT NULL,
    nombre TEXT,
    telefono TEXT,
    direccion TEXT,
    numero_calle TEXT,
    numero_casa TEXT,
    problematica_actual TEXT,
    creado TEXT DEFAULT (datetime('now')),
    UNIQUE(comunidad,cargo)
  )`,params:[]}]);
  for(const row of rowAssignments){
    await turso([{q:`INSERT INTO comite_vecinal_v2(id,comunidad,cargo,cedula,nombre,telefono,direccion,numero_calle,numero_casa,problematica_actual,creado)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,params:[row.id,row.comunidad,row.cargo,row.cedula,row.nombre,row.telefono,row.direccion,row.numero_calle,row.numero_casa,row.problematica_actual,row.creado]}]);
  }
  await turso([{q:'DROP TABLE comite_vecinal',params:[]}]);
  await turso([{q:'ALTER TABLE comite_vecinal_v2 RENAME TO comite_vecinal',params:[]}]);
  await turso([{q:'CREATE INDEX IF NOT EXISTS idx_comite_comunidad ON comite_vecinal(comunidad)',params:[]}]);
  await turso([{q:'CREATE INDEX IF NOT EXISTS idx_comite_cargo ON comite_vecinal(cargo)',params:[]}]);
  await turso([{q:'CREATE UNIQUE INDEX IF NOT EXISTS ux_comite_comunidad_cargo ON comite_vecinal(comunidad,cargo)',params:[]}]);
}
let rowAssignments=[];
const COMITE_CARGOS=['COORDINADOR','RESPONSABLE DE ORGANIZACIÓN','RESPONSABLE ELECTORAL','RESPONSABLE DE JUVENTUD','RESPONSABLE DE ACCIÓN SOCIAL'];

async function execSchema() {
  const existing=rowsFrom(await turso([{q:"SELECT name FROM sqlite_master WHERE type='table' AND name='comite_vecinal' LIMIT 1",params:[]}])));
  if(existing.length) await migrateComiteRoles();
  const marker=rowsFrom(await turso([{q:"SELECT name FROM sqlite_master WHERE type='table' AND name='erp_bootstrap_meta' LIMIT 1",params:[]}]));
  // Ejecutar migraciones estructurales también en bases ya inicializadas.
  const dirCols=rowsFrom(await turso([{q:'PRAGMA table_info(direccion_ejecutiva)',params:[]}]));
  if(dirCols.length){
    const dirIndexes=rowsFrom(await turso([{q:'PRAGMA index_list(direccion_ejecutiva)',params:[]}]));
    let dirCedulaUnique=false;
    for(const ix of dirIndexes){
      if(!ix.unique)continue;
      const info=rowsFrom(await turso([{q:"PRAGMA index_info('"+String(ix.name).replace(/'/g,"''")+"')",params:[]}]));
      if(info.length===1&&info[0].name==='cedula'){dirCedulaUnique=true;break;}
    }
    if(dirCedulaUnique){
      await turso([{q:`CREATE TABLE IF NOT EXISTS direccion_ejecutiva_legacy_backup (
        backup_id INTEGER PRIMARY KEY AUTOINCREMENT,
        backed_up_at TEXT NOT NULL DEFAULT (datetime('now')),
        legacy_id INTEGER,
        cargo TEXT,
        cedula TEXT,
        nombre TEXT,
        telefono TEXT,
        estructura TEXT,
        direccion TEXT,
        creado TEXT
      )`,params:[]}]);
      await turso([{q:`INSERT INTO direccion_ejecutiva_legacy_backup(legacy_id,cargo,cedula,nombre,telefono,estructura,direccion,creado)
        SELECT id,cargo,cedula,nombre,telefono,estructura,direccion,creado FROM direccion_ejecutiva`,params:[]}]);
      await turso([{q:`CREATE TABLE direccion_ejecutiva_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cargo TEXT NOT NULL UNIQUE,
        cedula TEXT NOT NULL,
        nombre TEXT,
        telefono TEXT,
        estructura TEXT,
        direccion TEXT,
        creado TEXT DEFAULT (datetime('now'))
      )`,params:[]}]);
      const dirRows=rowsFrom(await turso([{q:'SELECT id,cargo,cedula,nombre,telefono,estructura,direccion,creado FROM direccion_ejecutiva ORDER BY id',params:[]}]));
      const seenCargo=new Set();
      for(const row of dirRows){
        if(seenCargo.has(String(row.cargo))) throw new Error('Migración de Dirección Ejecutiva requiere revisión: cargo duplicado "'+String(row.cargo)+'". Los datos originales fueron respaldados en direccion_ejecutiva_legacy_backup.');
        seenCargo.add(String(row.cargo));
        await turso([{q:'INSERT INTO direccion_ejecutiva_v2(id,cargo,cedula,nombre,telefono,estructura,direccion,creado) VALUES(?,?,?,?,?,?,?,?)',params:[row.id,row.cargo,row.cedula,row.nombre,row.telefono,row.estructura,row.direccion,row.creado]}]);
      }
      await turso([{q:'DROP TABLE direccion_ejecutiva',params:[]}]);
      await turso([{q:'ALTER TABLE direccion_ejecutiva_v2 RENAME TO direccion_ejecutiva',params:[]}]);
      await turso([{q:'CREATE INDEX IF NOT EXISTS idx_dir_cargo ON direccion_ejecutiva(cargo)',params:[]}]);
    }
  }

  const warnings=[];
  for (const sql of SCHEMA) {
    try { await turso([{q:sql,params:[]}]); }
    catch(e) {
      if (isBenign(e)) warnings.push(String(e.message||e));
      else throw e;
    }
  }

  // En primera inicialización el esquema acaba de crear el comité con la restricción legacy; normalizarlo ahora.
  await migrateComiteRoles();

  // La columna ya forma parte del esquema actual; se conserva esta migración
  // para bases creadas por versiones anteriores.
  try {
    const actCols=rowsFrom(await turso([{q:'PRAGMA table_info(actas_mesa)',params:[]}]));
    if(actCols.length && !actCols.some(x=>x.name==='votos_partido')){
      await turso([{q:'ALTER TABLE actas_mesa ADD COLUMN votos_partido INTEGER NOT NULL DEFAULT 0',params:[]}]);
    }
  } catch(e) {
    if(!isBenign(e)) throw e;
  }

  for(let i=0;i<PROBLEMAS.length;i++){
    const [categoria,nombre]=PROBLEMAS[i];
    await turso([{q:'INSERT OR IGNORE INTO catalogo_problemas(categoria,nombre,orden) VALUES(?,?,?)',params:[categoria,nombre,i+1]}]);
  }

  const users=rowsFrom(await turso([{q:'SELECT COUNT(*) AS n FROM usuarios',params:[]}]));
  if(Number(users[0]?.n||0)===0){
    const seeds=[
      ['admin@comando.com','admin123','Administrador del Sistema','A','Administrador'],
      ['jefe','jefe123','Gualberto Martinez','J','Jefe de Comando'],
      ['operador','operador123','Pedro Rivas','O','Operador de Sala'],
      ['cdiaz','operador123','Carmen Díaz','O','Operadora Territorial']
    ];
    for(const [u,p,n,r,c] of seeds){
      await turso([{q:'INSERT OR IGNORE INTO usuarios(usuario,clave_hash,nombre,rol,cargo) VALUES(?,?,?,?,?)',params:[u,modernHash(p),n,r,c]}]);
    }
  }
  await turso([{q:"CREATE TABLE IF NOT EXISTS erp_bootstrap_meta (id INTEGER PRIMARY KEY CHECK(id=1), version TEXT NOT NULL, initialized_at TEXT NOT NULL DEFAULT (datetime('now')))",params:[]}]);
  await turso([{q:"INSERT OR REPLACE INTO erp_bootstrap_meta(id,version) VALUES(1,?)",params:["2026-09-19-h1"]}]);
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    await execSchema();
    if(req.internalBootstrap===true) return {ok:true,ready:true};
    const rows=rowsFrom(await turso([{q:'SELECT COUNT(*) AS n FROM padron',params:[]}]));
    return res.status(200).json({ok:true,ready:true,padron_count:Number(rows[0]?.n||0)});
  }catch(e){
    console.error('Bootstrap ERP:',e);
    return res.status(500).json({ok:false,error:e.message||'No se pudo inicializar la base de datos'});
  }
};
