-- CreateTable
CREATE TABLE "FailedJob" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobData" JSONB NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "attemptsMade" INTEGER NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailedJob_pkey" PRIMARY KEY ("id")
);
