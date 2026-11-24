'use client';
import { Alert, Button, Card, Checkbox, Statistic, Table, Tag, Typography, Upload } from 'antd';
import { AudioOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons';
import type { Cut, CutRow, Submission } from '@/lib/jobs/ledger';
import type { OwnVoice } from '@/lib/jobs/ownVoice';
import type { SummaryTiles } from '@/lib/jobs/summarise';

export type CutDetail = { cut: Cut; rows: CutRow[]; submissions: Submission[]; ownVoice?: OwnVoice | null };

const VOICE_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm';
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** One cut: the reel's tiles, the brief, your own voice if you dropped one, the mapped rows, the rejects, and Submit. */
export default function CutView({
  detail,
  submitting,
  force,
  onForce,
  onSubmit,
  onVoice,
  onClearVoice,
}: {
  detail: CutDetail;
  submitting: boolean;
  force: boolean;
  onForce: (v: boolean) => void;
  onSubmit: () => void;
  /** A recording of the whole reel, dropped on the cut; optional. */
  onVoice?: (file: File) => void;
  onClearVoice?: () => void;
}) {
  const { cut, rows, submissions } = detail;
  const ownVoice = detail.ownVoice ?? null;
  const s = cut.summary as SummaryTiles | null;
  const mapped = rows.filter((r) => r.row);
  const rejects = rows.filter((r) => !r.row);
  const last = submissions.at(-1);
  const canSubmit = cut.status !== 'thin' || force;
  const already = ['submitted', 'summarised', 'planned'].includes(cut.status);
  // Force matters when the cut is thin, when the board already has this period, or when
  // the last attempt was refused for either reason.
  const showForce = cut.status === 'thin' || already || cut.status === 'failed';

  return (
    <Card
      size="small"
      title={
        <span>
          Cut {cut.periodKey} <Tag>{cut.kind}</Tag> <Tag color={cut.status === 'failed' ? 'red' : cut.status === 'thin' ? 'gold' : 'blue'}>{cut.status}</Tag>
        </span>
      }
      extra={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {showForce && (
            <Checkbox checked={force} onChange={(e) => onForce(e.target.checked)} data-testid="force">
              force
            </Checkbox>
          )}
          <Button type="primary" size="small" icon={<SendOutlined />} loading={submitting} disabled={!canSubmit || (already && !force)} onClick={onSubmit} data-testid="submit">
            {already ? 'Submit again' : 'Submit'}
          </Button>
        </span>
      }
    >
      {cut.status === 'thin' && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={`Thin cut: ${cut.counted} rows`} description="Under the threshold. Tick force to send it anyway." />
      )}
      {last?.error && <Alert type="error" showIcon style={{ marginBottom: 12 }} title={`Last submit failed at ${last.stage ?? 'submit'}`} description={last.error} />}

      {onVoice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }} data-testid="own-voice">
          <AudioOutlined />
          <Typography.Text strong>Your voice</Typography.Text>
          {ownVoice ? (
            <>
              <Tag color="cyan" data-testid="own-voice-file">
                {ownVoice.name} · {mb(ownVoice.bytes)}
              </Tag>
              <Typography.Text type="secondary">Submit sends this recording; the plugin cuts the slides to it.</Typography.Text>
              <Button size="small" icon={<DeleteOutlined />} onClick={onClearVoice} data-testid="own-voice-clear">
                Use the studio voice instead
              </Button>
            </>
          ) : (
            <>
              <Typography.Text type="secondary">Optional. Drop one recording of the whole reel; otherwise the studio reads the lines.</Typography.Text>
              <Upload
                accept={VOICE_ACCEPT}
                showUploadList={false}
                maxCount={1}
                beforeUpload={(file) => {
                  onVoice(file as File);
                  return false;
                }}
              >
                <Button size="small" icon={<AudioOutlined />} data-testid="own-voice-pick">
                  Drop audio
                </Button>
              </Upload>
            </>
          )}
        </div>
      )}

      {s && (
        <div className="st-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 12 }} data-testid="tiles">
          <Statistic title="Roles" value={s.counted} />
          <Statistic title="Remote" value={s.byWorkMode.remote} />
          <Statistic title="Close in 7 days" value={s.closingSoon.within7Days} />
          <Statistic title="Rejected" value={s.rejected} />
          <Statistic title="Salary coverage" value={Math.round(s.salaryCoverage * 100)} suffix="%" />
        </div>
      )}
      {s && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {s.byFunction.map((f) => (
            <Tag key={f.key}>
              {f.label} {f.count}
            </Tag>
          ))}
          {s.topEmployers.map((e) => (
            <Tag key={e.company} color="geekblue">
              {e.company} {e.count}
            </Tag>
          ))}
          {s.topCities.map((c) => (
            <Tag key={c.city} color="green">
              {c.city} {c.count}
            </Tag>
          ))}
        </div>
      )}

      {cut.briefMd && (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer' }}>Brief from research-plugin</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8 }}>{cut.briefMd}</pre>
        </details>
      )}

      <Typography.Text strong>Rows ({mapped.length})</Typography.Text>
      <Table
        size="small"
        rowKey="researchId"
        dataSource={mapped}
        pagination={{ pageSize: 25, size: 'small' }}
        style={{ marginBottom: 12 }}
        columns={[
          { title: 'Role', key: 'role', render: (_: unknown, r: CutRow) => String(r.row?.role ?? '') },
          { title: 'Company', key: 'company', width: 160, render: (_: unknown, r: CutRow) => String(r.row?.company ?? '') },
          { title: 'Function', key: 'function', width: 110, render: (_: unknown, r: CutRow) => String(r.row?.function ?? '') },
          { title: 'Exp', key: 'exp', width: 70, render: (_: unknown, r: CutRow) => `${r.row?.experienceMin}-${r.row?.experienceMax}` },
          { title: 'Mode', key: 'mode', width: 80, render: (_: unknown, r: CutRow) => String(r.row?.workMode ?? '') },
          { title: 'City', key: 'city', width: 120, render: (_: unknown, r: CutRow) => String(r.row?.location ?? '') },
          { title: 'By', dataIndex: 'mappedBy', width: 70, render: (b: string) => <Tag color={b === 'qwen' ? 'purple' : 'default'}>{b}</Tag> },
        ]}
      />
      {rejects.length > 0 && (
        <>
          <Typography.Text strong>Rejected ({rejects.length})</Typography.Text>
          <Table
            size="small"
            rowKey="researchId"
            dataSource={rejects}
            pagination={{ pageSize: 10, size: 'small', hideOnSinglePage: true, showSizeChanger: false }}
            columns={[
              { title: 'Pool id', dataIndex: 'researchId', width: 100 },
              { title: 'Reason', dataIndex: 'rejectReason' },
            ]}
          />
        </>
      )}
    </Card>
  );
}
