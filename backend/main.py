from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import polars as pl
import numpy as np
from sklearn.neighbors import BallTree
import io
import math
import traceback
from datetime import datetime
import pandas as pd
import uvicorn

app = FastAPI(title="App Descargas Atmosféricas 2026")

# Montar frontend estático
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

def clean_lat(coord_series: pl.Series) -> pl.Series:
    def fix_lat(val):
        if val is None: return None
        val = str(val).strip()
        if not val: return None
        digits = ''.join(c for c in val if c.isdigit())
        if not digits: return None
        # Siempre debe empezar con 4 según el usuario
        if digits.startswith("4"):
            return float(f"4.{digits[1:]}")
        return float(f"{digits[0]}.{digits[1:]}")
    return coord_series.map_elements(fix_lat, return_dtype=pl.Float64)

def clean_lon(coord_series: pl.Series) -> pl.Series:
    def fix_lon(val):
        if val is None: return None
        val = str(val).strip()
        if not val: return None
        digits = ''.join(c for c in val if c.isdigit())
        if not digits: return None
        # Siempre debe empezar con -72 según el usuario
        if digits.startswith("72"):
            return float(f"-72.{digits[2:]}")
        elif digits.startswith("7") and len(digits) > 1:
            # Si alguien escribió 7.algo pero debia ser 72
            # asume -72.xxx
            return float(f"-72.{digits[1:]}")
        return float(f"-72.{digits}")
    return coord_series.map_elements(fix_lon, return_dtype=pl.Float64)

@app.post("/api/procesar")
async def procesar_datos(
    radio_busqueda_metros: float = Form(500.0),
    fecha_inicio: str = Form(None),
    fecha_fin: str = Form(None),
    filtro_campo: str = Form(""),
    filtro_locacion: str = Form(""),
    filtro_portico: str = Form("")
):
    try:
        # Archivos locales montados en el contenedor Docker en /app
        archivo_descargas = "Gold_Consolidado_Historico_Descargas_Electricas_GPK.parquet"
        archivo_postes = "Inventario_Estructuras_y_DPS.csv"

        try:
            # Detectar las columnas disponibles para leer lo minimo necesario
            schema = pl.read_parquet_schema(archivo_descargas)
            cols_to_read = []
            for c in ["Fecha", "Hora", "AÃ±o", "Año", "Mes", "Dia", "Latitud", "Longitud", "Corriente_kA", "Corriente (kA)"]:
                if c in schema:
                    cols_to_read.append(c)
            df_descargas = pl.read_parquet(archivo_descargas, columns=cols_to_read)
            
            # Filtro por fechas si el usuario lo envió
            if "Fecha" in df_descargas.columns:
                if fecha_inicio:
                    try:
                        dt_inicio = datetime.strptime(fecha_inicio, "%Y-%m-%d").date()
                        # Si la columna ya es Date, filtramos directo
                        if df_descargas.schema["Fecha"] == pl.Date:
                            df_descargas = df_descargas.filter(pl.col("Fecha") >= dt_inicio)
                        else:
                            df_descargas = df_descargas.filter(
                                pl.col("Fecha").str.strptime(pl.Date, "%Y-%m-%d", strict=False) >= dt_inicio
                            )
                    except Exception as e:
                        print(f"Error parseando fecha_inicio: {e}")
                if fecha_fin:
                    try:
                        dt_fin = datetime.strptime(fecha_fin, "%Y-%m-%d").date()
                        if df_descargas.schema["Fecha"] == pl.Date:
                            df_descargas = df_descargas.filter(pl.col("Fecha") <= dt_fin)
                        else:
                            df_descargas = df_descargas.filter(
                                pl.col("Fecha").str.strptime(pl.Date, "%Y-%m-%d", strict=False) <= dt_fin
                            )
                    except Exception as e:
                        print(f"Error parseando fecha_fin: {e}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo de descargas local: {str(e)}")

        try:
            with open(archivo_postes, 'r', encoding='latin-1') as f:
                content_postes = f.read()
            df_postes = pl.read_csv(io.BytesIO(content_postes.encode('utf-8')))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo de postes local: {str(e)}")

        # Columnas esperadas
        lat_poste_col = "Latitud_Manual"
        lon_poste_col = "Longitud_Manual"
        id_poste_col = "Estructura_Tag_Corregido" if "Estructura_Tag_Corregido" in df_postes.columns else "Estructura_Tag"
        if id_poste_col not in df_postes.columns:
            id_poste_col = df_postes.columns[0] # Fallback
            
        circuito_col = "Circuito_Corregido" if "Circuito_Corregido" in df_postes.columns else "Circuito"
        
        # Para descargas
        lat_desc_col = "Latitud" if "Latitud" in df_descargas.columns else "LATITUDE"
        lon_desc_col = "Longitud" if "Longitud" in df_descargas.columns else "LONGITUDE"
        corriente_col = "Corriente_kA" if "Corriente_kA" in df_descargas.columns else ("Corriente (kA)" if "Corriente (kA)" in df_descargas.columns else None)
        fecha_col = "Fecha" if "Fecha" in df_descargas.columns else ("Fecha_corta" if "Fecha_corta" in df_descargas.columns else ("FechaHora" if "FechaHora" in df_descargas.columns else None))

        if lat_poste_col not in df_postes.columns or lon_poste_col not in df_postes.columns:
            raise HTTPException(status_code=400, detail="Faltan columnas de lat/lon en postes")

        # Limpiar y preparar datos de postes
        cols_to_keep = [lat_poste_col, lon_poste_col, id_poste_col]
        if circuito_col in df_postes.columns: cols_to_keep.append(circuito_col)
        if "DSD" in df_postes.columns: cols_to_keep.append("DSD")
        if "DPS" in df_postes.columns: cols_to_keep.append("DPS")
        elif "DPS_Pararrayos" in df_postes.columns: cols_to_keep.append("DPS_Pararrayos")

        df_postes = df_postes.select(cols_to_keep).with_columns([
            clean_lat(pl.col(lat_poste_col)).alias("lat_clean"),
            clean_lon(pl.col(lon_poste_col)).alias("lon_clean")
        ]).filter(
            pl.col("lat_clean").is_not_null() & pl.col("lon_clean").is_not_null()
        )

        # Filtros en cascada desde Localizaciones.xlsx
        if filtro_campo or filtro_locacion or filtro_portico:
            try:
                df_loc = pd.read_excel("Localizaciones.xlsx").dropna(subset=['CAMPO', 'LOCACION / CIRCUITO', 'PORTICO / SWG / TRAMO'])
                # Filtro solicitado por usuario: CLASIF2 == "CIRCUITOS"
                df_loc = df_loc[df_loc['CLASIF2'].astype(str).str.strip().str.upper() == "CIRCUITOS"]
                
                if filtro_campo:
                    df_loc = df_loc[df_loc['CAMPO'].astype(str).str.strip() == filtro_campo]
                if filtro_locacion:
                    df_loc = df_loc[df_loc['LOCACION / CIRCUITO'].astype(str).str.strip() == filtro_locacion]
                if filtro_portico:
                    df_loc = df_loc[df_loc['PORTICO / SWG / TRAMO'].astype(str).str.strip() == filtro_portico]
                porticos_validos = df_loc['PORTICO / SWG / TRAMO'].astype(str).str.strip().tolist()
                df_postes = df_postes.filter(
                    pl.col(id_poste_col).cast(pl.Utf8).str.strip_chars().is_in(porticos_validos)
                )
            except Exception as e:
                print(f"Error aplicando filtros de Localizaciones.xlsx: {e}")

        # Preparar datos de descargas
        cols_desc = [lat_desc_col, lon_desc_col]
        if corriente_col: cols_desc.append(corriente_col)
        if fecha_col: cols_desc.append(fecha_col)

        df_descargas = df_descargas.select(cols_desc).with_columns([
            pl.col(lat_desc_col).cast(pl.Float64).alias("lat_desc_clean"),
            pl.col(lon_desc_col).cast(pl.Float64).alias("lon_desc_clean")
        ]).drop_nulls(subset=["lat_desc_clean", "lon_desc_clean"])
        
        # Opcional: ordenar descargas por fecha si existe para la gradiente temporal
        if fecha_col:
            df_descargas = df_descargas.sort(fecha_col)

        # Convertir a radianes para BallTree (haversine)
        EARTH_RADIUS_M = 6371000.0
        radius_rad = radio_busqueda_metros / EARTH_RADIUS_M

        descargas_coords_rad = np.radians(df_descargas.select(["lat_desc_clean", "lon_desc_clean"]).to_numpy())
        postes_coords_rad = np.radians(df_postes.select(["lat_clean", "lon_clean"]).to_numpy())

        # Construir BallTree sobre DESCARGAS
        tree = BallTree(descargas_coords_rad, leaf_size=40, metric='haversine')

        # Buscar todos los rayos dentro del radio para cada poste
        indices = tree.query_radius(postes_coords_rad, r=radius_rad)

        ids_rayos_a_mostrar = set()
        resumen_impactos = []
        
        dps_col = "DPS" if "DPS" in df_postes.columns else ("DPS_Pararrayos" if "DPS_Pararrayos" in df_postes.columns else None)

        for i, idx_array in enumerate(indices):
            if len(idx_array) > 0:
                # Poste i fue impactado por los rayos en idx_array
                ids_rayos_a_mostrar.update(idx_array)
                
                corriente_max = 0
                if corriente_col:
                    corrientes = df_descargas[idx_array.tolist()][corriente_col].to_list()
                    # filtrar None o nulos
                    corrientes = [c for c in corrientes if c is not None]
                    corriente_max = max(corrientes) if corrientes else 0

                row_poste = df_postes.row(i, named=True)
                resumen_impactos.append({
                    "TAG": row_poste.get(id_poste_col, f"Poste_{i}"),
                    "Circuito": row_poste.get(circuito_col, "N/A"),
                    "Latitud": row_poste["lat_clean"],
                    "Longitud": row_poste["lon_clean"],
                    "N_Impactos": len(idx_array),
                    "Corriente_Max_kA": round(corriente_max, 2)
                })

        # Extraer rayos a mostrar
        idx_list = sorted(list(ids_rayos_a_mostrar))
        df_rayos_filtrados = df_descargas[idx_list]

        # Preparar data para el Frontend
        estructuras_json = []
        for i, row in enumerate(df_postes.iter_rows(named=True)):
            tiene_dsd = str(row.get("DSD", "")).strip().upper() in ["SÍ", "SI", "TRUE"]
            tiene_dps = False
            if dps_col:
                tiene_dps = str(row.get(dps_col, "")).strip().upper() in ["SÍ", "SI", "TRUE"]
            
            estructuras_json.append({
                "id": row.get(id_poste_col, str(i)),
                "lat": row["lat_clean"],
                "lon": row["lon_clean"],
                "protegido": tiene_dsd or tiene_dps,
                "detalles": {
                    "Circuito": row.get(circuito_col, "N/A"),
                    "DSD": row.get("DSD", "No"),
                    "DPS": row.get(dps_col, "No") if dps_col else "No"
                }
            })

        rayos_json = []
        for i, row in enumerate(df_rayos_filtrados.iter_rows(named=True)):
            rayos_json.append({
                "lat": row["lat_desc_clean"],
                "lon": row["lon_desc_clean"],
                "corriente": row.get(corriente_col, 0),
                "fecha": str(row.get(fecha_col, "")),
                "orden": i 
            })

        return JSONResponse(content={
            "kpis": {
                "total_estructuras": len(df_postes),
                "estructuras_afectadas": len(resumen_impactos),
                "total_rayos": len(df_rayos_filtrados),
                "radio": radio_busqueda_metros
            },
            "estructuras": estructuras_json,
            "rayos": rayos_json,
            "impactos": resumen_impactos
        })

    except Exception as e:
        print(f"Error procesando datos: {e}")
        traceback.print_exc()
        return JSONResponse(
            status_code=400,
            content={"message": f"Error procesando datos: {str(e)}"}
        )

@app.get("/api/filtros")
async def obtener_filtros():
    try:
        df_loc = pd.read_excel("Localizaciones.xlsx")
        jerarquia = {}
        df_loc = df_loc.dropna(subset=['CAMPO', 'LOCACION / CIRCUITO', 'PORTICO / SWG / TRAMO'])
        
        # Filtro solicitado por usuario: CLASIF2 == "CIRCUITOS"
        df_loc = df_loc[df_loc['CLASIF2'].astype(str).str.strip().str.upper() == "CIRCUITOS"]
        
        for _, row in df_loc.iterrows():
            campo = str(row['CAMPO']).strip()
            locacion = str(row['LOCACION / CIRCUITO']).strip()
            portico = str(row['PORTICO / SWG / TRAMO']).strip()
            
            if campo not in jerarquia:
                jerarquia[campo] = {}
            if locacion not in jerarquia[campo]:
                jerarquia[campo][locacion] = []
            if portico not in jerarquia[campo][locacion]:
                jerarquia[campo][locacion].append(portico)
                
        # Ordenar alfabéticamente
        for campo in jerarquia:
            for loc in jerarquia[campo]:
                jerarquia[campo][loc].sort()
                
        return JSONResponse(content={"filtros": jerarquia})
    except Exception as e:
        print(f"Error cargando filtros: {e}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
