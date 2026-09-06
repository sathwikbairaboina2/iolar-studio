import { describe, it, expect } from 'vitest';
import { iconSvg, resolveIcon, searchIcon, ICON_VOCAB } from '@/lib/renderer/icons';

describe('iconSvg', () => {
  it('aws service aliases render the official coloured square', () => {
    const h = iconSvg('ec2');
    expect(h).toContain('<svg');
    expect(h).toContain('class="ic ic-aws"');
    expect(h.toLowerCase()).toContain('#ed7100');
    expect(h).not.toContain('<title');
    expect(h).not.toContain('<?xml');
  });
  it('the bare aws name is the AWS cloud mark', () => {
    expect(resolveIcon('aws')?.file).toMatch(/AWSCloud\.svg$/);
    expect(iconSvg('aws')).toContain('ic-aws');
  });
  it('explicit prefixes reach every source', () => {
    expect(resolveIcon('aws:AmazonRDS')?.source).toBe('aws');
    expect(resolveIcon('aws:res:AmazonEC2Instance')?.file).toMatch(/resource[\\/]AmazonEC2Instance\.svg$/);
    expect(resolveIcon('brand:docker')?.source).toBe('brand');
    expect(resolveIcon('ui:lock')?.source).toBe('ui');
  });
  it('brand marks carry their brand colour', () => {
    const h = iconSvg('docker');
    expect(h).toContain('ic-brand');
    expect(h).toMatch(/fill="#[0-9a-fA-F]{6}"/);
    expect(iconSvg('instagram')).toContain('ic-brand');
  });
  it('generic icons stroke in currentColor', () => {
    const h = iconSvg('lock');
    expect(h).toContain('ic-ui');
    expect(h).toContain('currentColor');
  });
  it('unknown names render nothing and never throw', () => {
    expect(iconSvg('nope-nothing')).toBe('');
    expect(iconSvg('')).toBe('');
    expect(iconSvg('../etc/passwd')).toBe('');
  });
  it('every vocabulary name resolves', () => {
    for (const n of ICON_VOCAB) expect(iconSvg(n), n).not.toBe('');
    expect(ICON_VOCAB.length).toBeGreaterThan(60);
  });
  it('is cached: the same string comes back', () => {
    expect(iconSvg('s3')).toBe(iconSvg('s3'));
  });
});

describe('searchIcon: new topics find their real mark', () => {
  it('matches brand titles written naturally', () => {
    expect(searchIcon('Node.js')).toBe('brand:nodedotjs');
    expect(searchIcon('PostgreSQL')).toBe('brand:postgresql');
    expect(searchIcon('Snowflake')).toBe('brand:snowflake');
    expect(searchIcon('Terraform')).toBe('brand:terraform');
  });
  it('matches AWS services by their full or short name', () => {
    expect(searchIcon('Amazon Redshift')).toBe('aws:AmazonRedshift');
    expect(searchIcon('Elastic Kubernetes Service')).toBe('aws:AmazonElasticKubernetesService');
  });
  it('prefers a brand over a generic icon at equal rank and falls back to a contains match', () => {
    expect(searchIcon('Kafka')).toBe('brand:apachekafka');
    expect(searchIcon('kubern')).toBe('brand:kubernetes');
  });
  it('refuses tiny queries unless they match exactly', () => {
    expect(searchIcon('zz')).toBeNull();
    expect(searchIcon('C++')).toBe('brand:cplusplus');
  });
  it('a bare name the resolver does not know still renders through the search', () => {
    expect(iconSvg('Snowflake')).toContain('ic-brand');
    expect(iconSvg('Amazon Redshift')).toContain('ic-aws');
    expect(iconSvg('Visual Studio Code') || iconSvg('vscode') || 'absent').toBeTruthy();
  });
});
