import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import * as simple from 'simple-icons';

/**
 * Real logos first. Three sources, most real first:
 *  - aws:   the official AWS Architecture Icons (coloured service squares, resource glyphs)
 *  - brand: simple-icons brand marks, filled with the brand's own colour
 *  - ui:    lucide line icons, stroked in currentColor so the family's ink tints them
 * A bare name goes through the alias map, then exact names in each source, then a name
 * search across every brand title, AWS service and generic icon — so a new topic
 * ("Snowflake", "Node.js", "Amazon Redshift") finds its real mark without a pre-list.
 */
export type IconSource = 'aws' | 'brand' | 'ui';
export type ResolvedIcon = { source: IconSource; file: string; color?: string };

const ROOT = path.join(process.cwd(), 'node_modules');
const AWS = path.join(ROOT, 'aws-icons', 'icons');
const BRAND = path.join(ROOT, 'simple-icons', 'icons');
const UI = path.join(ROOT, 'lucide-static', 'icons');

const AWS_SERVICE: Record<string, string> = {
  ec2: 'AmazonEC2', s3: 'AmazonSimpleStorageService', rds: 'AmazonRDS', lambda: 'AWSLambda',
  vpc: 'AmazonVirtualPrivateCloud', iam: 'AWSIdentityandAccessManagement', cloudwatch: 'AmazonCloudWatch',
  route53: 'AmazonRoute53', cloudfront: 'AmazonCloudFront', elb: 'ElasticLoadBalancing',
  alb: 'ElasticLoadBalancing', nlb: 'ElasticLoadBalancing', eks: 'AmazonElasticKubernetesService',
  ecs: 'AmazonElasticContainerService', ecr: 'AmazonElasticContainerRegistry',
  ebs: 'AmazonElasticBlockStore', efs: 'AmazonEFS', fsx: 'AmazonFSx', glacier: 'AmazonSimpleStorageServiceGlacier',
  kms: 'AWSKeyManagementService', waf: 'AWSWAF', guardduty: 'AmazonGuardDuty',
  cloudtrail: 'AWSCloudTrail', config: 'AWSConfig', ssm: 'AWSSystemsManager',
  cloudformation: 'AWSCloudFormation', trustedadvisor: 'AWSTrustedAdvisor',
  eventbridge: 'AmazonEventBridge', organizations: 'AWSOrganizations', redshift: 'AmazonRedshift',
  elasticache: 'AmazonElastiCache', documentdb: 'AmazonDocumentDB', lightsail: 'AmazonLightsail',
  batch: 'AWSBatch', aurora: 'AmazonAurora', directconnect: 'AWSDirectConnect',
  transitgateway: 'AWSTransitGateway', vpn: 'AWSSitetoSiteVPN', storagegateway: 'AWSStorageGateway',
  sns: 'AmazonSimpleNotificationService', sqs: 'AmazonSimpleQueueService', kinesis: 'AmazonKinesis',
  apigateway: 'AmazonAPIGateway', cognito: 'AmazonCognito', stepfunctions: 'AWSStepFunctions',
  dynamodb: 'AmazonDynamoDB', autoscaling: 'AWSAutoScaling',
};

const BRANDS = ['docker', 'kubernetes', 'mongodb', 'redis', 'mysql', 'postgresql', 'instagram', 'linux', 'netapp',
  'python', 'github', 'git', 'nodedotjs', 'openjdk', 'terraform', 'googlecloud', 'nginx', 'apachekafka',
  'sqlite', 'ubuntu', 'react', 'android', 'apple'];

const UI_NAMES = ['user', 'users', 'lock', 'unlock', 'key', 'shield', 'shield-check', 'globe', 'file-text', 'folder',
  'phone', 'smartphone', 'laptop', 'monitor', 'bell', 'chart-bar', 'clock', 'settings', 'network', 'mail',
  'rocket', 'lightbulb', 'calendar', 'tag', 'search', 'triangle-alert', 'refresh-cw', 'download', 'upload',
  'database', 'server', 'cloud', 'cpu', 'hard-drive', 'box', 'layers', 'link', 'gavel', 'building-2',
  'credit-card', 'dollar-sign', 'badge-check', 'circle-check', 'circle-x', 'star', 'pin', 'camera', 'image',
  'video', 'music', 'code', 'terminal', 'braces', 'list', 'table', 'archive', 'inbox', 'send', 'zap',
  'crown', 'eye', 'map-pin', 'route', 'wifi', 'bug', 'wrench', 'package', 'book', 'graduation-cap'];

/** Names the planner may use directly. Anything else goes through the name search. */
export const ICON_VOCAB: string[] = [
  'aws', ...Object.keys(AWS_SERVICE), ...BRANDS, 'windows', 'oracle', 'azure',
  ...UI_NAMES,
];

// Names with no mark in any source, pointed at the generic icon that says what they are.
const SPECIAL: Record<string, string> = {
  aws: 'builtin:aws', 'aws-cloud': 'group:AWSCloud', windows: 'ui:monitor', oracle: 'ui:database', azure: 'ui:cloud',
  uvicorn: 'ui:server', hypercorn: 'ui:server', daphne: 'ui:server', httpx: 'ui:globe', asyncio: 'brand:python',
  // Concept words. The fuzzy name search below would send each one to whichever brand has the word
  // in its title (Index → Podcast Index, Cache → Cachet, Query → jQuery), so a page about a
  // concept would wear a vendor's logo. They draw the generic icon unless a real name is given.
  index: 'ui:list', indexing: 'ui:list', indexes: 'ui:list', cache: 'ui:zap', caching: 'ui:zap',
  data: 'ui:database', query: 'ui:search', queries: 'ui:search', storage: 'ui:hard-drive',
  replication: 'ui:refresh-cw', replica: 'ui:copy', replicas: 'ui:copy', sharding: 'ui:layers', partitioning: 'ui:layers',
  transaction: 'ui:arrow-left-right', transactions: 'ui:arrow-left-right', locking: 'ui:lock', latency: 'ui:clock',
  join: 'ui:link', joins: 'ui:link', orders: 'ui:package', scaling: 'ui:trending-up',
};

/**
 * Marks no package ships. The AWS wordmark: "aws" in a heavy sans plus the orange smile
 * arrow, drawn as paths so it needs no font. Close to the real mark, as the reference draws it.
 */
const BUILTIN: Record<string, string> = {
  aws: '<svg viewBox="0 0 120 72" xmlns="http://www.w3.org/2000/svg"><text x="60" y="44" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="46" letter-spacing="-1" fill="#232f3e">aws</text><path d="M14 56 C 40 74, 84 74, 108 54" fill="none" stroke="#ff9900" stroke-width="6" stroke-linecap="round"/><path d="M100 46 L 110 53 L 98 58" fill="none" stroke="#ff9900" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

type SimpleIcon = { title: string; slug: string; hex: string };
const SIMPLE = simple as unknown as Record<string, SimpleIcon | undefined>;

function brandHex(slug: string): string | undefined {
  for (const v of Object.values(SIMPLE)) if (v && v.slug === slug) return `#${v.hex}`;
  return undefined;
}

function safe(seg: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(seg);
}

/** simple-icons slug rules: C++ → cplusplus, C# → csharp, Node.js → nodedotjs. Plain form kept too. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\+/g, 'plus').replace(/#/g, 'sharp').replace(/\./g, 'dot').replace(/[^a-z0-9]/g, '');
}
function plain(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------- name search ----
type Entry = { ref: string; norms: string[]; title: string };
let INDEX: Entry[] | null = null;

function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

function buildIndex(): Entry[] {
  const out: Entry[] = [];
  const dirs = [['architecture-service', 'aws'], ['resource', 'aws:res'], ['architecture-group', 'group']] as const;
  for (const [dir, prefix] of dirs) {
    const full = path.join(AWS, dir);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full)) {
      if (!f.endsWith('.svg')) continue;
      const name = f.slice(0, -4);
      const title = splitCamel(name.replace(/^(Amazon|AWS)/, ''));
      out.push({ ref: `${prefix}:${name}`, norms: [norm(name), norm(title), plain(title)], title });
    }
  }
  for (const v of Object.values(SIMPLE)) {
    if (!v || !v.slug) continue;
    out.push({ ref: `brand:${v.slug}`, norms: [norm(v.title), plain(v.title), norm(v.slug)], title: v.title });
  }
  if (existsSync(UI)) {
    for (const f of readdirSync(UI)) {
      if (!f.endsWith('.svg')) continue;
      const name = f.slice(0, -4);
      out.push({ ref: `ui:${name}`, norms: [norm(name)], title: name });
    }
  }
  return out;
}

/**
 * Finds the icon whose name best matches a free-text query: an exact normalised match wins,
 * then the shortest name that starts with the query, then the shortest that contains it
 * (queries under three characters only match exactly). Brands are preferred over AWS
 * resource glyphs and generic icons at equal rank because they are the "real logo".
 */
export function searchIcon(query: string): string | null {
  const q = norm(query);
  const qp = plain(query);
  if (!q) return null;
  INDEX ??= buildIndex();
  const rank = (e: Entry) => (e.ref.startsWith('brand:') ? 0 : e.ref.startsWith('aws:res') ? 2 : e.ref.startsWith('ui:') ? 3 : 1);
  const pick = (cands: Entry[]) =>
    cands.sort((a, b) => rank(a) - rank(b) || Math.min(...a.norms.map((n) => n.length)) - Math.min(...b.norms.map((n) => n.length)))[0]?.ref ?? null;
  const exact = INDEX.filter((e) => e.norms.includes(q));
  if (exact.length) return pick(exact);
  const exactPlain = qp !== q ? INDEX.filter((e) => e.norms.includes(qp)) : [];
  if (exactPlain.length) return pick(exactPlain);
  if (q.length < 3) return null;
  const starts = INDEX.filter((e) => e.norms.some((n) => n.startsWith(q)));
  if (starts.length) return pick(starts);
  const contains = INDEX.filter((e) => e.norms.some((n) => n.includes(q)));
  return contains.length ? pick(contains) : null;
}

// ------------------------------------------------------------------- resolve ----
export function resolveIcon(name: string): ResolvedIcon | null {
  const n = (name || '').trim();
  if (!n) return null;
  const special = SPECIAL[n.toLowerCase()];
  if (special) return resolveIcon(special);

  const m = /^(aws|brand|ui|group|builtin):(?:(res):)?(.+)$/.exec(n);
  if (m) {
    const [, src, res, rest] = m;
    if (!safe(rest)) return null;
    if (src === 'builtin') return BUILTIN[rest] ? { source: 'ui', file: `builtin:${rest}` } : null;
    if (src === 'aws') {
      const file = path.join(AWS, res ? 'resource' : 'architecture-service', `${AWS_SERVICE[rest.toLowerCase()] ?? rest}.svg`);
      return existsSync(file) ? { source: 'aws', file } : null;
    }
    if (src === 'group') {
      const file = path.join(AWS, 'architecture-group', `${rest}.svg`);
      return existsSync(file) ? { source: 'aws', file } : null;
    }
    if (src === 'brand') {
      const file = path.join(BRAND, `${rest.toLowerCase()}.svg`);
      return existsSync(file) ? { source: 'brand', file, color: brandHex(rest.toLowerCase()) } : null;
    }
    const file = path.join(UI, `${rest.toLowerCase()}.svg`);
    return existsSync(file) ? { source: 'ui', file } : null;
  }

  const lower = n.toLowerCase();
  if (AWS_SERVICE[lower]) return resolveIcon(`aws:${lower}`);
  // A generic word that is also some company's name (box, cloud, shield) means the generic icon.
  if (UI_NAMES.includes(lower)) return resolveIcon(`ui:${lower}`);
  if (safe(n)) {
    const direct = resolveIcon(`aws:${n}`) ?? resolveIcon(`brand:${lower}`) ?? resolveIcon(`ui:${lower}`);
    if (direct) return direct;
  }
  const found = searchIcon(n);
  return found ? resolveIcon(found) : null;
}

// --------------------------------------------------------------------- render ----
const cache = new Map<string, string>();

function clean(svg: string): string {
  return svg
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .trim();
}

export function iconSvg(name: string): string {
  const key = (name || '').trim();
  if (!key) return '';
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const r = resolveIcon(key);
  let out = '';
  if (r) {
    try {
      let svg = r.file.startsWith('builtin:') ? BUILTIN[r.file.slice(8)] : clean(readFileSync(r.file, 'utf8'));
      const attrs = ` class="ic ic-${r.source}" width="1em" height="1em"`;
      svg = svg.replace(/<svg([^>]*)>/, (_, a: string) => {
        let head = a.replace(/\s(width|height|class)="[^"]*"/g, '');
        if (r.source === 'brand') {
          head = head.replace(/\sfill="[^"]*"/g, '');
          head += ` fill="${r.color ?? 'currentColor'}"`;
        }
        if (r.source === 'ui') head = head.replace(/\sstroke="[^"]*"/g, '') + ' stroke="currentColor"';
        return `<svg${head}${attrs}>`;
      });
      out = svg;
    } catch {
      out = '';
    }
  }
  cache.set(key, out);
  return out;
}
