import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ImagePlus, RefreshCcw, Trash2, Upload, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const MAX_UPLOAD_MB = 8;
const COMPRESS_TARGET_MB = 1.8;
const MAX_DIMENSION = 1600;

interface PhotoUploadFieldProps {
  value: string;
  onChange: (value: string) => void;
}

const isMobileDevice = () =>
  typeof window !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

async function compressImage(file: File): Promise<string> {
  const imgUrl = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imgUrl;
  });

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(imgUrl);
    throw new Error("Could not initialize image processor");
  }
  ctx.drawImage(image, 0, 0, width, height);

  const quality = file.size > COMPRESS_TARGET_MB * 1024 * 1024 ? 0.72 : 0.84;
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  URL.revokeObjectURL(imgUrl);
  return dataUrl;
}

function validateImage(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file only.";
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `Image is too large. Max allowed size is ${MAX_UPLOAD_MB}MB.`;
  }
  return null;
}

export function PhotoUploadField({ value, onChange }: PhotoUploadFieldProps) {
  const [open, setOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mobile = useMemo(() => isMobileDevice(), []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const handleImageFile = async (file: File) => {
    const err = validateImage(file);
    if (err) {
      toast.error(err);
      return;
    }
    setProcessing(true);
    try {
      const compressed = await compressImage(file);
      onChange(compressed);
      toast.success("Photo attached successfully.");
      setOpen(false);
      setCameraOpen(false);
    } catch {
      toast.error("Could not process image. Try another photo.");
    } finally {
      setProcessing(false);
      stopCamera();
    }
  };

  const handleInputPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleImageFile(file);
    event.target.value = "";
  };

  const openDesktopCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.info("Webcam unavailable. Opening file chooser instead.");
      cameraInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setCameraOpen(true);
      setOpen(false);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current
            .play()
            .then(() => setCameraReady(true))
            .catch(() => {
              setCameraReady(false);
              toast.error("Unable to start webcam preview.");
            });
        }
      }, 60);
    } catch {
      toast.error("Camera access denied. You can still upload from gallery.");
    }
  };

  const captureFromWebcam = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("Unable to capture photo.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    onChange(dataUrl);
    toast.success("Captured from camera.");
    setCameraOpen(false);
    stopCamera();
  };

  return (
    <div className="space-y-2.5">
      <Label>Photo</Label>
      <div className="glass rounded-xl p-3">
        {value ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-3"
          >
            <img src={value} alt="Emergency attachment preview" className="h-44 w-full rounded-lg object-cover border border-border" />
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="flex-1">
                <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Retake / Change
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.button
            type="button"
            whileHover={{ y: -2, rotateX: 3 }}
            whileTap={{ y: 0, scale: 0.99 }}
            onClick={() => setOpen(true)}
            className="w-full rounded-xl border border-dashed border-primary/40 px-4 py-6 text-sm text-muted-foreground transition-colors hover:text-foreground hover:border-primary/70"
          >
            <Upload className="h-5 w-5 mx-auto mb-2 text-primary" />
            Add emergency photo
          </motion.button>
        )}
      </div>

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleInputPick}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleInputPick}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="sm:max-w-xl sm:mx-auto sm:rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Add photo</SheetTitle>
            <SheetDescription>Choose how you want to attach an emergency image.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 grid gap-2">
            <Button
              type="button"
              variant="outline"
              className="justify-start h-11 rounded-xl"
              onClick={() => galleryInputRef.current?.click()}
              disabled={processing}
            >
              <ImagePlus className="h-4 w-4 mr-2" /> Select from gallery
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-start h-11 rounded-xl"
              onClick={() => (mobile ? cameraInputRef.current?.click() : openDesktopCamera())}
              disabled={processing}
            >
              <Camera className="h-4 w-4 mr-2" /> Capture from camera
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="justify-start h-11 rounded-xl"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              disabled={!value || processing}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Remove selected photo
            </Button>
            <Button type="button" variant="ghost" className="justify-start h-11 rounded-xl" onClick={() => setOpen(false)}>
              <X className="h-4 w-4 mr-2" /> Cancel
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Images only, up to 8MB. Large photos are optimized automatically.</p>
        </SheetContent>
      </Sheet>

      <Sheet
        open={cameraOpen}
        onOpenChange={(next) => {
          setCameraOpen(next);
          if (!next) stopCamera();
        }}
      >
        <SheetContent side="bottom" className="sm:max-w-xl sm:mx-auto sm:rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Capture photo</SheetTitle>
            <SheetDescription>Frame the scene clearly to help responders verify context.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
              <video ref={videoRef} autoPlay muted playsInline className="h-60 w-full object-cover" />
            </div>
            <div className="flex gap-2">
              <Button type="button" className="flex-1 gradient-hero border-0" onClick={captureFromWebcam} disabled={!cameraReady}>
                <Camera className="h-4 w-4 mr-1.5" /> Capture now
              </Button>
              <Button type="button" variant="outline" onClick={() => setCameraOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
