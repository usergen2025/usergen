import {
  detectExternalMediaProvider,
  extractGoogleDriveFileId,
  normalizeExternalMediaUrl,
  sniffVideoFormat,
} from './external-url-resolver';

describe('external-url-resolver', () => {
  describe('extractGoogleDriveFileId', () => {
    it('parses /file/d/<id>/view share links', () => {
      expect(
        extractGoogleDriveFileId(
          'https://drive.google.com/file/d/1sIzm1SZg56A8yvay7Xwi4j9kNSAW00cZ/view?usp=sharing',
        ),
      ).toBe('1sIzm1SZg56A8yvay7Xwi4j9kNSAW00cZ');
    });

    it('parses open?id= links', () => {
      expect(extractGoogleDriveFileId('https://drive.google.com/open?id=abc123XYZ')).toBe('abc123XYZ');
    });

    it('returns null for unrelated URLs', () => {
      expect(extractGoogleDriveFileId('https://example.com/video.mp4')).toBeNull();
    });
  });

  describe('detectExternalMediaProvider', () => {
    it('detects google drive', () => {
      expect(
        detectExternalMediaProvider('https://drive.google.com/file/d/abc/view'),
      ).toBe('google-drive');
    });

    it('detects dropbox', () => {
      expect(detectExternalMediaProvider('https://www.dropbox.com/s/abc/video.mp4?dl=0')).toBe('dropbox');
    });

    it('detects onedrive', () => {
      expect(detectExternalMediaProvider('https://1drv.ms/v/c/abc')).toBe('onedrive');
    });

    it('falls back to direct', () => {
      expect(detectExternalMediaProvider('https://cdn.example.com/clip.mp4')).toBe('direct');
    });
  });

  describe('normalizeExternalMediaUrl', () => {
    it('builds google drive usercontent download URL', () => {
      const { provider, url } = normalizeExternalMediaUrl(
        'https://drive.google.com/file/d/abc123/view?usp=sharing',
      );
      expect(provider).toBe('google-drive');
      expect(url).toContain('drive.usercontent.google.com/download');
      expect(url).toContain('id=abc123');
    });

    it('forces dropbox dl=1', () => {
      const { provider, url } = normalizeExternalMediaUrl(
        'https://www.dropbox.com/s/xyz/video.mp4?dl=0',
      );
      expect(provider).toBe('dropbox');
      expect(url).toContain('dl=1');
    });

    it('adds onedrive download=1', () => {
      const { provider, url } = normalizeExternalMediaUrl('https://onedrive.live.com/?id=root');
      expect(provider).toBe('onedrive');
      expect(url).toContain('download=1');
    });
  });

  describe('sniffVideoFormat', () => {
    it('detects mp4 ftyp', () => {
      const buf = Buffer.alloc(32);
      buf.write('????ftypisom', 0);
      expect(sniffVideoFormat(buf)?.ext).toBe('.mp4');
    });

    it('detects webm', () => {
      const buf = Buffer.alloc(16);
      buf.writeUInt8(0x1a, 0);
      buf.writeUInt8(0x45, 1);
      buf.writeUInt8(0xdf, 2);
      buf.writeUInt8(0xa3, 3);
      expect(sniffVideoFormat(buf)?.ext).toBe('.webm');
    });

    it('returns null for random bytes', () => {
      expect(sniffVideoFormat(Buffer.from('not a video file'))).toBeNull();
    });
  });
});
