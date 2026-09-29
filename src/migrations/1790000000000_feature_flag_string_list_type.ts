import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Real SoC decision lists from the PM's "Android - Per Chipset Exclusion List" spreadsheet
// (its "List - Per Chipset" tab, Decision column), as of 2026-09-28. Canonical form matches
// normalizeFlagValue()'s 'string-list' output: deduped, sorted, minified JSON.
const ANDROID_EXCLUDED_SOCS = '["3215U","3865U","3965Y","A133","A133PRO","A333","A4-9120C","A523","A527","A537","A733","AMLA311D2","AMLT982","APQ8052","APQ8053","APQ8056","APQ8076","APQ8096","ASR8661","ASR8662","EXYNOS 7420","EXYNOS 7872","EXYNOS 7880","EXYNOS 7884","EXYNOS 7884B","EXYNOS 7885","EXYNOS 7904","EXYNOS 850","EXYNOS 8890","EXYNOS 9609","EXYNOS 9610","EXYNOS 9611","I.MX8M-MINI","KIRIN655","KIRIN658","KIRIN659","KIRIN710","KIRIN710F","KIRIN950","KIRIN955","KIRIN960","KIRIN960S","MSM8917","MSM8937","MSM8939","MSM8940","MSM8952","MSM8953","MSM8953 PRO","MSM8956","MSM8974","MSM8976","MSM8976SG","MSM8992","MSM8994","MSM8996","MSM8996PRO","MT6575","MT6580","MT6580M","MT6735","MT6737","MT6737T","MT6739CH","MT6739CW","MT6739WA","MT6739WW","MT6750","MT6752","MT6753","MT6755","MT6755M","MT6757","MT6757CD","MT6757V","MT6761","MT6761D","MT6761V/CA","MT6761V/CAB","MT6761V/WAB","MT6761V/WB","MT6761V/WBB","MT6761V/WE","MT6762","MT6762D","MT6762G","MT6762M","MT6762V/CA","MT6762V/CB","MT6762V/WA","MT6762V/WB","MT6762V/WD","MT6763","MT6763T","MT6765","MT6765G","MT6765H","MT6765V/CA","MT6765V/CB","MT6765V/WA","MT6765V/WB","MT6765V/XAA","MT6765V/XBA","MT6765X","MT6768","MT6769","MT6769H","MT6769T","MT6769V/CA","MT6769V/CB","MT6769V/CT","MT6769V/CZ","MT6769V/WY","MT6769Z","MT6771","MT6771T","MT6797","MT6797M","MT6799","MT8166B","MT8167A","MT8167B","MT8167D","MT8168A","MT8168B","MT8173","MT8175","MT8176A","MT8183","MT8183A","MT8186","MT8186B","MT8365","MT8385","MT8765A","MT8765B","MT8765C/A","MT8765W/A","MT8765W/B","MT8766","MT8766A","MT8766B","MT8768","MT8768A","MT8768B","MT8768CA","MT8768E","MT8768N","MT8768T","MT8768V/CX","MT8768W/A","MT8768WA","MT8768WE","MT8768WT","MT8783T","MT8786","MT8786V/CA","MT8786V/CT","MT8786V/CU","MT8788","MT8788A","MT8788B","MT9679","MT9950","MTK6582M","N4000","N4500","QCM2290","QCM4290","QCM6125","QCS2290","QCS4290","QM215","RK3326","RK3368A","RK3399","RK3562","RK3566","RK3568","RK3576","RTD1319","SC1408AJ1","SC7731E","SC9830A","SC9832","SC9832A","SC9832E","SC9838A","SC9863A","SC9863T","SDA450","SDA660","SDA670","SDM427","SDM429","SDM435","SDM439","SDM450","SDM630","SDM632","SDM636","SDM660","SDM670","SM4250","SM6115","SM6125","SXR1130","T310","T603","T606","T610","T612","T615","T616","T618","T7510","TEGRA X1 T210","UMS312","UMS9230","UMS9230E","UMS9230H","UMS9230T"]'

const ANDROID_BELOW_MINSPEC_SOCS = '["EXYNOS 880","EXYNOS 8895","EXYNOS 980","EXYNOS 9810","I3-7130U","I7-7Y75","KIRIN810","KIRIN970","M3-7Y30","M3-8100Y","MSM8998","MT6779","MT6779P90","MT6779P95","MT6779V/CE","MT6781","MT6781V/CD","MT6785","MT6785T","MT6785U","MT6785V/CD","MT6785V/WU","MT6785V/WV","MT6789","MT6789V/CD","MT6789V/CDZA","MT6833","MT6833P","MT6833V/MNZA","MT6833V/NZA","MT6833V/PNZA","MT6833V/ZA","MT6835","MT6835V/TZ","MT6835V/ZA","MT6853","MT6853T","MT6853V/NZA","MT6853V/TNZA","MT6853V/ZA","MT6855","MT6855V/AZA","MT6858","MT6873","MT6881","MT8188AV/A","MT8189","MT8192","MT8370AV/A","MT8371","MT8390AV/A","MT8391","MT8755","MT8771","MT8771V/NZA","MT8781V/CA","MT8781V/NA","MT8789","MT8789V/CT","MT8789V/T","MT8789V/WT","QCM4325","QCM4490","QCS4490","RK3583","S5E8365","S5E8535","SC7180","SDM675","SDM710","SDM712","SDM845","SM4350","SM4375","SM4450","SM4450P","SM4635","SM4850","SM6150","SM6225","SM6350","SM6375","SM7125","SM7150","SM7225","SM7250","T619","T620","T750","T760","T765","T770","UMS9230S","UMS9360","UMS9620","UMS9621S","UMS9632","UMS9632S"]'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('feature_flags', 'feature_flags_type_check')
  pgm.addConstraint('feature_flags', 'feature_flags_type_check', {
    check: "type IN ('on-off', 'text', 'number', 'string-list')"
  })

  // on-off flags carry no value; text/number/string-list flags always carry one
  pgm.dropConstraint('feature_flags', 'feature_flags_value_by_type')
  pgm.addConstraint('feature_flags', 'feature_flags_value_by_type', {
    check: "(type = 'on-off' AND value IS NULL) OR (type IN ('text', 'number', 'string-list') AND value IS NOT NULL)"
  })

  pgm.sql(`
    INSERT INTO feature_flags (name, type, value, description) VALUES
      ('android-excluded-socs', 'string-list', '${ANDROID_EXCLUDED_SOCS}',
        'Android chipsets godot-explorer treats as end-of-support (Play Store excluded) — device-support-modals #2936'),
      ('android-below-minspec-socs', 'string-list', '${ANDROID_BELOW_MINSPEC_SOCS}',
        'Android chipsets godot-explorer treats as below minimum spec but still supported — device-support-modals #2935')
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("DELETE FROM feature_flags WHERE type = 'string-list'")
  pgm.dropConstraint('feature_flags', 'feature_flags_value_by_type')
  pgm.addConstraint('feature_flags', 'feature_flags_value_by_type', {
    check: "(type = 'on-off' AND value IS NULL) OR (type IN ('text', 'number') AND value IS NOT NULL)"
  })
  pgm.dropConstraint('feature_flags', 'feature_flags_type_check')
  pgm.addConstraint('feature_flags', 'feature_flags_type_check', {
    check: "type IN ('on-off', 'text', 'number')"
  })
}
