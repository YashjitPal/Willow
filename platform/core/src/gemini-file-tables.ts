// GENERATED from Gemini's client bundle — do not edit by hand.
//
// Five lookup tables decide how an attachment tile renders. Two groups, each
// index-aligned, so a value must never be inserted into one without the others:
//
//   KNOWN_MIME_TYPES[i]  <-> MIME_EXTENSION[i] <-> MIME_FILE_TYPE[i]   (255 entries)
//   KNOWN_EXTENSIONS[j]  <-> EXTENSION_MIME[j]                        (243 entries)
//
// MIME_EXTENSION has 95 blanks: mimes Gemini recognises but gives no canonical
// extension. Blank means "no extension", not "missing data".

/** Mimes whose tile Gemini renders with a Drive type icon. Aligned to the two arrays below. */
export const KNOWN_MIME_TYPES: readonly string[] = [
  'application/dart', 'application/ecmascript', 'application/gzip', 'application/json',
  'application/ms-java', 'application/msword', 'application/pdf', 'application/protobuf',
  'application/sql', 'application/typescript', 'application/vnd.apache.parquet',
  'application/vnd.curl', 'application/vnd.dart', 'application/vnd.google-apps.document',
  'application/vnd.google-apps.folder', 'application/vnd.google-apps.kix',
  'application/vnd.google-apps.presentation', 'application/vnd.google-apps.punch',
  'application/vnd.google-apps.ritz', 'application/vnd.google-apps.spreadsheet',
  'application/vnd.ibm.secure-container', 'application/vnd.jupyter', 'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/x-csh', 'application/x-gzip', 'application/x-hwp', 'application/x-hwp-v5',
  'application/x-latex', 'application/x-php', 'application/x-powershell',
  'application/x-protobuf; type=bard.data.hydra.Logits.Content',
  'application/x-protobuf; type=chrome_intelligence_proto_features.AnnotatedPageContent',
  'application/x-protobuf; type=chrome_intelligence_proto_features.annotatedpagecontent',
  'application/x-protobuf; type=gdm_flair_distillation.Logits', 'application/x-sh',
  'application/x-shellscript', 'application/x-tex', 'application/x-zsh', 'application/xml',
  'application/zip', 'audio/G722', 'audio/L16', 'audio/MP4A-LATM', 'audio/aac', 'audio/adts',
  'audio/aiff', 'audio/amr', 'audio/basic', 'audio/bit', 'audio/g723', 'audio/iLBC',
  'audio/m4a', 'audio/mpeg', 'audio/ogg', 'audio/pcm', 'audio/wav', 'audio/x-ac3',
  'audio/x-adpcm', 'audio/x-caf', 'audio/x-dca', 'audio/x-eac3', 'audio/x-flac', 'audio/x-gsm',
  'audio/x-m4a', 'audio/x-oma', 'audio/x-speex', 'audio/x-tta', 'audio/x-voc', 'audio/x-wav',
  'audio/x-wavpack', 'image/avif', 'image/bmp', 'image/gif', 'image/heic', 'image/heif',
  'image/jpeg', 'image/png', 'image/svg+xml', 'image/tiff', 'image/webp', 'image/x-adobe-dng',
  'message/rfc822', 'text/1d-interleaved-parityfec', 'text/RED', 'text/SGML',
  'text/cache-manifest', 'text/calendar', 'text/cql', 'text/cql-extension',
  'text/cql-identifier', 'text/css', 'text/csv', 'text/csv-schema', 'text/dns', 'text/encaprtp',
  'text/enriched', 'text/example', 'text/fhirpath', 'text/flexfec', 'text/fwdred', 'text/gff3',
  'text/grammar-ref-list', 'text/hl7v2', 'text/html', 'text/javascript', 'text/jcr-cnd',
  'text/jsx', 'text/markdown', 'text/mizar', 'text/n3', 'text/parameters', 'text/parityfec',
  'text/php', 'text/plain', 'text/provenance-notation', 'text/prs.fallenstein.rst',
  'text/prs.lines.tag', 'text/prs.prop.logic', 'text/raptorfec', 'text/rfc822-headers',
  'text/rtf', 'text/rtp-enc-aescm128', 'text/rtploopback', 'text/rtx', 'text/sgml',
  'text/shaclc', 'text/shex', 'text/spdx', 'text/strings', 'text/t140',
  'text/tab-separated-values', 'text/texmacs', 'text/troff', 'text/tsv', 'text/tsx',
  'text/turtle', 'text/ulpfec', 'text/uri-list', 'text/vcard', 'text/vnd.DMClientScript',
  'text/vnd.IPTC.NITF', 'text/vnd.IPTC.NewsML', 'text/vnd.a', 'text/vnd.abc',
  'text/vnd.ascii-art', 'text/vnd.curl', 'text/vnd.debian.copyright', 'text/vnd.dvb.subtitle',
  'text/vnd.esmertec.theme-descriptor', 'text/vnd.exchangeable', 'text/vnd.familysearch.gedcom',
  'text/vnd.ficlab.flt', 'text/vnd.fly', 'text/vnd.fmi.flexstor', 'text/vnd.gml',
  'text/vnd.graphviz', 'text/vnd.hans', 'text/vnd.hgl', 'text/vnd.in3d.3dml',
  'text/vnd.in3d.spot', 'text/vnd.latex-z', 'text/vnd.motorola.reflex',
  'text/vnd.ms-mediapackage', 'text/vnd.net2phone.commcenter.command',
  'text/vnd.radisys.msml-basic-layout', 'text/vnd.senx.warpscript', 'text/vnd.sosi',
  'text/vnd.sun.j2me.app-descriptor', 'text/vnd.trolltech.linguist', 'text/vnd.wap.si',
  'text/vnd.wap.sl', 'text/vnd.wap.wml', 'text/vnd.wap.wmlscript', 'text/vtt', 'text/wgsl',
  'text/x-asm', 'text/x-bibtex', 'text/x-boo', 'text/x-c', 'text/x-c++hdr', 'text/x-c++src',
  'text/x-cassandra', 'text/x-chdr', 'text/x-coffeescript', 'text/x-component', 'text/x-csh',
  'text/x-csharp', 'text/x-csrc', 'text/x-cuda', 'text/x-d', 'text/x-diff', 'text/x-dsrc',
  'text/x-emacs-lisp', 'text/x-erlang', 'text/x-gff3', 'text/x-go', 'text/x-haskell',
  'text/x-java', 'text/x-java-properties', 'text/x-java-source', 'text/x-kotlin',
  'text/x-lilypond', 'text/x-lisp', 'text/x-literate-haskell', 'text/x-lua', 'text/x-moc',
  'text/x-objcsrc', 'text/x-pascal', 'text/x-pcs-gcd', 'text/x-perl', 'text/x-perl-script',
  'text/x-python', 'text/x-python-script', 'text/x-r-markdown', 'text/x-rsrc', 'text/x-rst',
  'text/x-ruby-script', 'text/x-rust', 'text/x-sass', 'text/x-scala', 'text/x-scheme',
  'text/x-script.python', 'text/x-scss', 'text/x-setext', 'text/x-sfv', 'text/x-sh',
  'text/x-siesta', 'text/x-sos', 'text/x-sql', 'text/x-swift', 'text/x-tcl', 'text/x-tex',
  'text/x-vbasic', 'text/x-vcalendar', 'text/xml', 'text/xml-dtd',
  'text/xml-external-parsed-entity', 'text/yaml', 'video/3gpp', 'video/3gpp2', 'video/avi',
  'video/mp4', 'video/mpeg', 'video/mpg', 'video/quicktime', 'video/webm', 'video/x-flv',
  'video/x-m4v', 'video/x-matroska', 'video/x-ms-wmv',
];

/** Canonical extension per {@link KNOWN_MIME_TYPES} entry; empty string where none exists. */
export const MIME_EXTENSION: readonly string[] = [
  'dart', 'es', 'gz', 'json', '', 'doc', 'pdf', 'pb', '', 'ts', 'parquet', 'curl', '', '', '',
  '', '', '', '', '', 'sc', 'ipynb', 'xls', 'odt', 'pptx', 'xlsx', 'docx', 'dotx', 'csh', '',
  'hwp', '', 'tex', 'php', 'ps1', '', '', '', '', 'sh', '', '', 'zsh', 'xml', 'zip', 'g722',
  'l16', 'latm', 'aac', 'adts', 'aiff', 'amr', '', '', 'g723_1', 'ilbc', 'm4a', 'mp3', 'oga',
  'pcm', 'wav', 'ac3', '4xm', 'caf', 'dts', 'eac3', 'flac', 'gsm', '', 'oma', 'spo', 'tta',
  'voc', '', 'wv', 'avif', 'bmp', 'gif', 'heic', 'heif', 'jpg', 'png', 'svg', 'tif', 'webp',
  'dng', 'eml', '', '', '', 'manifest', 'ics', '', '', '', 'css', 'csv', '', 'zone', '', '', '',
  '', '', '', '', '', '', 'html', 'js', '', 'jsx', 'md', '', '', '', '', '', 'txt', 'provn', '',
  '', '', '', '', 'rtf', '', '', '', 'sgml', 'shaclc', 'shex', 'spdx', '', '', 'tsv', 'tm',
  'roff', '', 'tsx', 'ttl', '', 'uri', 'vcard', '', '', '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', 'gv', '', '', '3dml', 'spot', '', '', '', '', '', '', '', 'jad', '', '', '',
  'wml', 'wmls', 'vtt', 'wgsl', 'asm', 'bib', 'boo', '', 'hh', 'cc', 'cql', 'h', 'coffee',
  'htc', '', 'cs', 'c', 'cu', 'd', 'diff', '', 'el', 'erl', 'gff3', 'go', 'hs', '',
  'properties', 'java', 'kt', 'ly', 'lsp', 'lhs', 'lua', 'moc', 'm', 'p', '', 'pm', 'pl', '',
  'py', 'rmd', 'r', 'rst', 'rb', 'rs', 'sass', 'scala', 'scm', '', 'scss', 'etx', 'sfv', '',
  'si', 'sos', 'sql', 'swift', 'tcl', 'sty', 'cls', 'vcs', '', '', '', 'yml', '3gpp', '3g2',
  'avi', 'mp4', 'mpeg', 'mpg', 'mov', 'webm', 'flv', 'm4v', 'mkv', 'wmv',
];

/** Gemini's internal file-type number per {@link KNOWN_MIME_TYPES} entry. */
export const MIME_FILE_TYPE: readonly number[] = [
  3, 3, 9, 5, 3, 10, 11, 3, 3, 3, 3, 3, 3, 8, 17, 8, 13, 13, 6, 6, 3, 3, 7, 14, 12, 7, 10, 10,
  3, 9, 15, 15, 3, 3, 3, 3, 18, 18, 3, 3, 3, 3, 3, 3, 9, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 19, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
];

/** Extensions Gemini treats as source code, which route to the single `text/code` icon. */
export const CODE_EXTENSIONS: readonly string[] = [
  'asm', 'asset', 'bib', 'boo', 'c', 'c++', 'cc', 'ccc', 'clang-format', 'class', 'cls',
  'coffee', 'conf', 'config', 'cpp', 'cql', 'cs', 'csh', 'css', 'cu', 'cuh', 'curl', 'cxx', 'd',
  'dart', 'el', 'erl', 'es', 'ets', 'flake8', 'gitignore', 'go', 'gv', 'h', 'h++', 'hh', 'hpp',
  'hrl', 'hs', 'htc', 'htm', 'html', 'hxx', 'in', 'ini', 'ipynb', 'jad', 'java', 'js', 'json',
  'json5', 'jsx', 'jtd', 'kt', 'ktm', 'lhs', 'local', 'lsp', 'ltx', 'lua', 'm', 'manifest',
  'map', 'md', 'meta', 'metal', 'mjs', 'mm', 'mo', 'n3', 'p', 'pas', 'patch', 'php', 'pie',
  'pl', 'pm', 'po', 'properties', 'ps1', 'py', 'r', 'rb', 'rmd', 'rs', 's', 'sample', 'sass',
  'sc', 'scala', 'scm', 'scss', 'sgm', 'sgml', 'sh', 'shaclc', 'shex', 'shtml', 'si', 'sl',
  'sos', 'spo', 'sql', 'sty', 'swift', 'symbols', 't', 'tag', 'tcl', 'tk', 'tm', 'toml', 'tr',
  'ts', 'tsx', 'ttl', 'types', 'uri', 'uris', 'vue', 'wgsl', 'wml', 'wmls', 'xml', 'yaml',
  'yml', 'zone', 'zsh',
];

/** Extensions Gemini can name a mime for. Aligned to {@link EXTENSION_MIME}. */
export const KNOWN_EXTENSIONS: readonly string[] = [
  '3dml', '3g2', '3gpp', '4xm', 'aac', 'ac3', 'adts', 'aiff', 'amr', 'appcache', 'ascii', 'asm',
  'asset', 'avi', 'avif', 'avifs', 'bib', 'bmp', 'boo', 'brf', 'c', 'c++', 'caf', 'cc', 'ccc',
  'cfg', 'clang-format', 'class', 'cls', 'cnd', 'coffee', 'conf', 'config', 'copyright', 'cpp',
  'cql', 'cs', 'csh', 'css', 'csv', 'cu', 'cuh', 'curl', 'cxx', 'd', 'dart', 'diff', 'dng',
  'doc', 'docx', 'dot', 'dotx', 'dsc', 'dts', 'eac3', 'el', 'eml', 'erl', 'es', 'ets', 'etx',
  'flac', 'flake8', 'flv', 'g722', 'g723_1', 'gff3', 'gif', 'gitignore', 'go', 'gsm', 'gv',
  'gz', 'h', 'h++', 'har', 'heic', 'heif', 'hh', 'hpp', 'hrl', 'hs', 'htc', 'htm', 'html',
  'hwp', 'hwpx', 'hxx', 'ics', 'ilbc', 'in', 'ini', 'ipynb', 'jad', 'java', 'jpe', 'jpeg',
  'jpg', 'js', 'json', 'json5', 'jsx', 'jtd', 'kt', 'ktm', 'kts', 'l16', 'latm', 'lhs', 'local',
  'log', 'lsp', 'ltx', 'lua', 'ly', 'm', 'm4a', 'm4v', 'manifest', 'map', 'markdown', 'md',
  'meta', 'metal', 'miz', 'mjs', 'mkv', 'mm', 'mo', 'moc', 'mov', 'mp2', 'mp3', 'mp4', 'mpeg',
  'mpega', 'mpf', 'mpg', 'mpga', 'n3', 'odt', 'oga', 'oma', 'p', 'parquet', 'pas', 'patch',
  'pb', 'pcm', 'pdf', 'php', 'pie', 'pl', 'pm', 'png', 'po', 'pot', 'pptx', 'properties',
  'provn', 'ps1', 'py', 'r', 'rb', 'rd', 'rmd', 'roff', 'rs', 'rst', 'rtf', 's', 'sample',
  'sass', 'sc', 'scala', 'scm', 'scss', 'sfv', 'sgm', 'sgml', 'sh', 'shaclc', 'shc', 'shex',
  'shtml', 'si', 'sl', 'sos', 'spdx', 'spo', 'spot', 'sql', 'srt', 'sty', 'svg', 'swift',
  'symbols', 't', 'tab', 'tag', 'tcl', 'tex', 'text', 'tif', 'tiff', 'tk', 'tm', 'toml', 'tr',
  'ts', 'tsv', 'tsx', 'tta', 'ttl', 'txt', 'types', 'uri', 'uris', 'vcard', 'vcf', 'vcs', 'voc',
  'vtt', 'vue', 'wav', 'wave', 'webm', 'webp', 'wgsl', 'wml', 'wmls', 'wmv', 'wv', 'xlb', 'xls',
  'xlsx', 'xlt', 'xml', 'yaml', 'yml', 'zip', 'zone', 'zsh',
];

/** Mime per {@link KNOWN_EXTENSIONS} entry. */
export const EXTENSION_MIME: readonly string[] = [
  'text/vnd.in3d.3dml', 'video/3gpp2', 'video/3gpp', 'audio/x-adpcm', 'audio/aac',
  'audio/x-ac3', 'audio/adts', 'audio/aiff', 'audio/amr', 'text/cache-manifest', 'text/plain',
  'text/x-asm', 'text/plain', 'video/avi', 'image/avif', 'image/avif', 'text/x-bibtex',
  'image/bmp', 'text/x-boo', 'text/plain', 'text/x-csrc', 'text/x-c++src', 'audio/x-caf',
  'text/x-c++src', 'text/x-c++src', 'text/plain', 'text/plain', 'text/plain', 'text/x-vbasic',
  'text/plain', 'text/x-coffeescript', 'text/plain', 'text/plain', 'text/plain',
  'text/x-c++src', 'text/x-cassandra', 'text/x-csharp', 'application/x-csh', 'text/css',
  'text/csv', 'text/x-cuda', 'text/x-cuda', 'application/vnd.curl', 'text/x-c++src', 'text/x-d',
  'application/dart', 'text/x-diff', 'image/x-adobe-dng', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template', 'text/plain',
  'audio/x-dca', 'audio/x-eac3', 'text/x-emacs-lisp', 'message/rfc822', 'text/x-erlang',
  'application/ecmascript', 'text/plain', 'text/x-setext', 'audio/x-flac', 'text/plain',
  'video/x-flv', 'audio/G722', 'audio/g723', 'text/x-gff3', 'image/gif', 'text/plain',
  'text/x-go', 'audio/x-gsm', 'text/vnd.graphviz', 'application/gzip', 'text/x-chdr',
  'text/x-c++hdr', 'application/json', 'image/heic', 'image/heif', 'text/x-c++hdr',
  'text/x-c++hdr', 'text/x-erlang', 'text/x-haskell', 'text/x-component', 'text/html',
  'text/html', 'application/x-hwp', 'application/x-hwp', 'text/x-c++hdr', 'text/calendar',
  'audio/iLBC', 'text/plain', 'text/plain', 'application/vnd.jupyter',
  'text/vnd.sun.j2me.app-descriptor', 'text/x-java-source', 'image/jpeg', 'image/jpeg',
  'image/jpeg', 'text/javascript', 'application/json', 'text/plain', 'text/jsx',
  'application/json', 'text/x-kotlin', 'text/x-kotlin', 'text/x-kotlin', 'audio/L16',
  'audio/MP4A-LATM', 'text/x-literate-haskell', 'text/plain', 'text/plain', 'text/x-lisp',
  'application/x-latex', 'text/x-lua', 'text/x-lilypond', 'text/x-objcsrc', 'audio/m4a',
  'video/x-m4v', 'text/cache-manifest', 'text/plain', 'text/plain', 'text/markdown',
  'text/plain', 'text/plain', 'text/plain', 'text/javascript', 'video/x-matroska', 'text/plain',
  'text/plain', 'text/x-moc', 'video/quicktime', 'audio/mpeg', 'audio/mpeg', 'video/mp4',
  'video/mpeg', 'audio/mpeg', 'text/plain', 'video/mpg', 'audio/mpeg', 'text/plain',
  'application/vnd.oasis.opendocument.text', 'audio/ogg', 'audio/x-oma', 'text/x-pascal',
  'application/vnd.apache.parquet', 'text/x-pascal', 'text/x-diff', 'application/protobuf',
  'audio/pcm', 'application/pdf', 'application/x-php', 'text/plain', 'text/x-perl-script',
  'text/x-perl', 'image/png', 'text/plain', 'text/plain',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/x-java-properties', 'text/provenance-notation', 'application/x-powershell',
  'text/x-python-script', 'text/x-rsrc', 'text/x-ruby-script', 'text/plain',
  'text/x-r-markdown', 'text/troff', 'text/x-rust', 'text/x-rst', 'text/rtf', 'text/x-asm',
  'text/plain', 'text/x-sass', 'application/vnd.ibm.secure-container', 'text/x-scala',
  'text/x-scheme', 'text/x-scss', 'text/x-sfv', 'text/sgml', 'text/sgml', 'application/x-sh',
  'text/shaclc', 'application/x-sh', 'text/shex', 'text/plain', 'text/x-siesta', 'text/plain',
  'text/x-sos', 'text/spdx', 'audio/x-speex', 'text/vnd.in3d.spot', 'text/x-sql', 'text/plain',
  'text/x-tex', 'image/svg+xml', 'text/x-swift', 'text/plain', 'text/troff',
  'text/tab-separated-values', 'text/plain', 'text/x-tcl', 'application/x-latex', 'text/plain',
  'image/tiff', 'image/tiff', 'text/x-tcl', 'text/texmacs', 'text/plain', 'text/troff',
  'application/typescript', 'text/tab-separated-values', 'text/tsx', 'audio/x-tta',
  'text/turtle', 'text/plain', 'text/plain', 'text/uri-list', 'text/uri-list', 'text/vcard',
  'text/vcard', 'text/x-vcalendar', 'audio/x-voc', 'text/vtt', 'text/plain', 'audio/wav',
  'audio/wav', 'video/webm', 'image/webp', 'text/wgsl', 'text/vnd.wap.wml',
  'text/vnd.wap.wmlscript', 'video/x-ms-wmv', 'audio/x-wavpack', 'application/vnd.ms-excel',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'application/xml', 'text/yaml', 'text/yaml', 'application/zip',
  'text/dns', 'application/x-zsh',
];

/** Extension-less filenames Gemini still treats as code, matched on the basename. */
export const CODE_BASENAMES: readonly string[] = [
  'BUILD', 'makefile',
];

// Which tile shape a file gets is decided by EXTENSION, not by mime: Gemini renders a
// cover-cropped thumbnail only when the name ends in one of these. A PNG served as
// application/octet-stream still gets a thumbnail; an "image/png" named `report` does not.

/** Extensions that render as a cover-cropped image thumbnail. */
export const THUMBNAIL_IMAGE_EXTENSIONS: readonly string[] = [
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'svg', 'eps', 'psd', 'ai',
  'xcf', 'cr2', 'nef', 'arw', 'dng',
  // Behind a runtime flag upstream; enabled here because browsers we target decode AVIF.
  'avif',
];

/** Extensions that render as a video thumbnail tile with a duration overlay. */
export const THUMBNAIL_VIDEO_EXTENSIONS: readonly string[] = [
  '3gp', 'mov', 'mp4', 'webm',
];
