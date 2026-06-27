package app.gitvisualizer.events.service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.config.GitHubApiProperties;
import app.gitvisualizer.events.client.model.GitHubEvent;
import app.gitvisualizer.events.dto.EventView;
import app.gitvisualizer.events.support.EventMapper;

@Component
public class EventReleaseScheduler {

	private final TaskScheduler taskScheduler;
	private final EventBroadcaster broadcaster;
	private final EventMapper eventMapper;
	private final GitHubApiProperties properties;

	private final AtomicLong liveGeneration = new AtomicLong(0);
	private final List<ScheduledFuture<?>> pendingLiveTasks = new CopyOnWriteArrayList<>();
	private final List<PendingLiveRelease> pendingLiveReleases = new CopyOnWriteArrayList<>();
	private final Object deadlineLock = new Object();
	private final Object lastBatchLock = new Object();
	private Instant batchDeadline;
	private List<GitHubEvent> lastPollBatch = List.of();

	public EventReleaseScheduler(
			TaskScheduler taskScheduler,
			EventBroadcaster broadcaster,
			EventMapper eventMapper,
			GitHubApiProperties properties) {
		this.taskScheduler = taskScheduler;
		this.broadcaster = broadcaster;
		this.eventMapper = eventMapper;
		this.properties = properties;
	}

	public void enqueueBatch(List<GitHubEvent> events, int windowSeconds) {
		if (events.isEmpty()) {
			return;
		}

		synchronized (lastBatchLock) {
			lastPollBatch = List.copyOf(events);
		}

		if (!properties.gradualReleaseEnabled()) {
			for (GitHubEvent event : events) {
				release(event);
			}
			return;
		}

		flushUnreleasedLiveEvents();
		List<GitHubEvent> sorted = sortOldestFirst(events);
		long generation = liveGeneration.incrementAndGet();
		cancelPendingLiveTasks();

		synchronized (deadlineLock) {
			batchDeadline = Instant.now().plusSeconds(windowSeconds);
		}

		scheduleLiveDrip(sorted, windowSeconds, generation);
	}

	public Runnable replayToEmitter(SseEmitter emitter, List<EventView> events, int windowSeconds) {
		if (events.isEmpty()) {
			return () -> { };
		}

		if (!properties.gradualReleaseEnabled()) {
			for (EventView event : events) {
				broadcaster.sendToEmitter(emitter, event);
			}
			return () -> { };
		}

		List<EventView> sorted = sortViewsOldestFirst(events);
		List<ScheduledFuture<?>> replayTasks = new CopyOnWriteArrayList<>();
		scheduleDrip(sorted, windowSeconds, event -> broadcaster.sendToEmitter(emitter, event), replayTasks);
		return () -> {
			for (ScheduledFuture<?> future : replayTasks) {
				future.cancel(false);
			}
			replayTasks.clear();
		};
	}

	public List<EventView> lastPollBatchViews() {
		synchronized (lastBatchLock) {
			return lastPollBatch.stream()
					.map(eventMapper::toView)
					.toList();
		}
	}

	public int remainingWindowSeconds() {
		synchronized (deadlineLock) {
			if (batchDeadline == null) {
				return properties.releaseWindowSeconds();
			}
			long remaining = Duration.between(Instant.now(), batchDeadline).getSeconds();
			return (int) Math.max(1, remaining);
		}
	}

	private void scheduleLiveDrip(List<GitHubEvent> events, int windowSeconds, long generation) {
		int count = events.size();
		long windowMs = windowSeconds * 1000L;

		for (int eventIndex = 0; eventIndex < count; eventIndex++) {
			GitHubEvent event = events.get(eventIndex);
			EventView view = eventMapper.toView(event);
			PendingLiveRelease pending = new PendingLiveRelease(event, view);
			pendingLiveReleases.add(pending);

			long delayMs = (long) eventIndex * windowMs / count;
			ScheduledFuture<?> future = taskScheduler.schedule(
					() -> releaseIfPending(pending, generation),
					Instant.now().plusMillis(delayMs));
			pendingLiveTasks.add(future);
		}
	}

	private void scheduleDrip(
			List<EventView> events,
			int windowSeconds,
			Consumer<EventView> sender,
			List<ScheduledFuture<?>> futures) {
		int count = events.size();
		long windowMs = windowSeconds * 1000L;

		for (int eventIndex = 0; eventIndex < count; eventIndex++) {
			long delayMs = (long) eventIndex * windowMs / count;
			EventView event = events.get(eventIndex);
			ScheduledFuture<?> future = taskScheduler.schedule(
					() -> sender.accept(event),
					Instant.now().plusMillis(delayMs));
			futures.add(future);
		}
	}

	private void releaseIfPending(PendingLiveRelease pending, long generation) {
		if (generation != liveGeneration.get()) {
			return;
		}
		releasePending(pending);
	}

	private void flushUnreleasedLiveEvents() {
		for (PendingLiveRelease pending : pendingLiveReleases) {
			releasePending(pending);
		}
		pendingLiveReleases.clear();
	}

	private void releasePending(PendingLiveRelease pending) {
		if (!pending.released.compareAndSet(false, true)) {
			return;
		}
		release(pending.event());
	}

	private void release(GitHubEvent event) {
		broadcaster.broadcast(eventMapper.toView(event));
	}

	private void cancelPendingLiveTasks() {
		for (ScheduledFuture<?> future : pendingLiveTasks) {
			future.cancel(false);
		}
		pendingLiveTasks.clear();
	}

	private static List<GitHubEvent> sortOldestFirst(List<GitHubEvent> events) {
		List<GitHubEvent> sorted = new ArrayList<>(events);
		sorted.sort(Comparator.comparing(
				EventReleaseScheduler::parseEventCreatedAt,
				Comparator.nullsLast(Comparator.naturalOrder())));
		return sorted;
	}

	private static List<EventView> sortViewsOldestFirst(List<EventView> events) {
		List<EventView> sorted = new ArrayList<>(events);
		sorted.sort(Comparator.comparing(
				EventReleaseScheduler::parseViewCreatedAt,
				Comparator.nullsLast(Comparator.naturalOrder())));
		return sorted;
	}

	private static Instant parseEventCreatedAt(GitHubEvent event) {
		if (event.createdAt() == null || event.createdAt().isBlank()) {
			return null;
		}
		return Instant.parse(event.createdAt());
	}

	private static Instant parseViewCreatedAt(EventView event) {
		if (event.createdAt() == null || event.createdAt().isBlank()) {
			return null;
		}
		return Instant.parse(event.createdAt());
	}

	private static final class PendingLiveRelease {
		private final GitHubEvent event;
		private final EventView view;
		private final AtomicBoolean released = new AtomicBoolean(false);

		private PendingLiveRelease(GitHubEvent event, EventView view) {
			this.event = event;
			this.view = view;
		}

		private GitHubEvent event() {
			return event;
		}
	}
}
