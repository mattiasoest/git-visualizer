package app.gitvisualizer.events.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ScheduledFuture;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.Trigger;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.config.GitHubApiProperties;
import app.gitvisualizer.events.client.model.Actor;
import app.gitvisualizer.events.client.model.GitHubEvent;
import app.gitvisualizer.events.client.model.RepoRef;
import app.gitvisualizer.events.dto.EventView;
import app.gitvisualizer.events.support.EventMapper;

class EventReleaseSchedulerTest {

	private EventBroadcaster broadcaster;
	private EventMapper eventMapper;
	private RecordingTaskScheduler taskScheduler;
	private EventReleaseScheduler scheduler;

	@BeforeEach
	void setUp() {
		broadcaster = mock(EventBroadcaster.class);
		eventMapper = mock(EventMapper.class);
		when(eventMapper.toView(any(GitHubEvent.class))).thenAnswer(invocation -> {
			GitHubEvent event = invocation.getArgument(0);
			return view(event.id(), event.createdAt());
		});

		taskScheduler = new RecordingTaskScheduler();
		scheduler = new EventReleaseScheduler(
				taskScheduler,
				broadcaster,
				eventMapper,
				new GitHubApiProperties(
						"https://api.github.com",
						"/events",
						"",
						100,
						60,
						true,
						60));
	}

	@Test
	void enqueueBatchIsNoOpForEmptyList() {
		scheduler.enqueueBatch(List.of(), 10);

		assertThat(taskScheduler.scheduledTasks).isEmpty();
		verifyNoInteractions(broadcaster);
	}

	@Test
	void enqueueBatchDripsOldestFirstWithEvenSpacing() {
		List<GitHubEvent> events = List.of(
				githubEvent("3", "2026-06-13T12:00:03Z"),
				githubEvent("1", "2026-06-13T12:00:01Z"),
				githubEvent("2", "2026-06-13T12:00:02Z"),
				githubEvent("4", "2026-06-13T12:00:04Z"),
				githubEvent("5", "2026-06-13T12:00:05Z"));

		scheduler.enqueueBatch(events, 10);
		taskScheduler.runAllInOrder();

		List<Long> relativeDelays = taskScheduler.scheduledTasks.stream()
				.map(ScheduledTask::delayMs)
				.sorted()
				.toList();
		for (int delayIndex = 0; delayIndex < relativeDelays.size(); delayIndex++) {
			long expected = relativeDelays.getFirst() + (long) delayIndex * 2_000L;
			assertThat(relativeDelays.get(delayIndex)).isCloseTo(expected, within(50L));
		}

		verify(broadcaster, times(1)).broadcast(view("1", "2026-06-13T12:00:01Z"));
		verify(broadcaster, times(1)).broadcast(view("2", "2026-06-13T12:00:02Z"));
		verify(broadcaster, times(1)).broadcast(view("3", "2026-06-13T12:00:03Z"));
		verify(broadcaster, times(1)).broadcast(view("4", "2026-06-13T12:00:04Z"));
		verify(broadcaster, times(1)).broadcast(view("5", "2026-06-13T12:00:05Z"));
	}

	@Test
	void newBatchFlushesUnreleasedEventsFromPreviousBatch() {
		List<GitHubEvent> firstBatch = List.of(githubEvent("1", "2026-06-13T12:00:01Z"));
		List<GitHubEvent> secondBatch = List.of(githubEvent("2", "2026-06-13T12:00:02Z"));

		scheduler.enqueueBatch(firstBatch, 10);
		scheduler.enqueueBatch(secondBatch, 10);
		taskScheduler.runAllInOrder();

		verify(broadcaster, times(1)).broadcast(view("1", "2026-06-13T12:00:01Z"));
		verify(broadcaster, times(1)).broadcast(view("2", "2026-06-13T12:00:02Z"));
	}

	@Test
	void replayToEmitterDripsToSingleEmitterWithoutBroadcasting() {
		SseEmitter emitter = mock(SseEmitter.class);
		List<EventView> events = List.of(
				view("2", "2026-06-13T12:00:02Z"),
				view("1", "2026-06-13T12:00:01Z"));

		scheduler.replayToEmitter(emitter, events, 10);
		taskScheduler.runAllInOrder();

		verify(broadcaster).sendToEmitter(emitter, view("1", "2026-06-13T12:00:01Z"));
		verify(broadcaster).sendToEmitter(emitter, view("2", "2026-06-13T12:00:02Z"));
		verify(broadcaster, never()).broadcast(any());
	}

	@Test
	void replayToEmitterCancelStopsPendingDripTasks() {
		SseEmitter emitter = mock(SseEmitter.class);
		List<EventView> events = List.of(
				view("1", "2026-06-13T12:00:01Z"),
				view("2", "2026-06-13T12:00:02Z"),
				view("3", "2026-06-13T12:00:03Z"));

		Runnable cancelReplay = scheduler.replayToEmitter(emitter, events, 10);
		cancelReplay.run();
		taskScheduler.runAllInOrder();

		verify(broadcaster, never()).sendToEmitter(any(), any());
		verify(broadcaster, never()).broadcast(any());
	}

	@Test
	void remainingWindowSecondsUsesActiveBatchDeadline() {
		scheduler.enqueueBatch(List.of(githubEvent("1", "2026-06-13T12:00:01Z")), 60);

		int remaining = scheduler.remainingWindowSeconds();

		assertThat(remaining).isBetween(59, 60);
	}

	@Test
	void remainingWindowSecondsFallsBackToConfiguredDefault() {
		assertThat(scheduler.remainingWindowSeconds()).isEqualTo(60);
	}

	@Test
	void lastPollBatchViewsReturnsMostRecentBatchOnly() {
		List<GitHubEvent> firstBatch = List.of(githubEvent("1", "2026-06-13T12:00:01Z"));
		List<GitHubEvent> secondBatch = List.of(
				githubEvent("2", "2026-06-13T12:00:02Z"),
				githubEvent("3", "2026-06-13T12:00:03Z"));

		scheduler.enqueueBatch(firstBatch, 10);
		scheduler.enqueueBatch(secondBatch, 10);

		assertThat(scheduler.lastPollBatchViews())
				.extracting(EventView::id)
				.containsExactly("2", "3");
	}

	@Test
	void lastPollBatchViewsIsEmptyBeforeAnyPoll() {
		assertThat(scheduler.lastPollBatchViews()).isEmpty();
	}

	@Test
	void gradualReleaseDisabledReleasesImmediately() {
		EventReleaseScheduler immediateScheduler = new EventReleaseScheduler(
				taskScheduler,
				broadcaster,
				eventMapper,
				new GitHubApiProperties(
						"https://api.github.com",
						"/events",
						"",
						100,
						60,
						false,
						60));

		List<GitHubEvent> events = List.of(
				githubEvent("2", "2026-06-13T12:00:02Z"),
				githubEvent("1", "2026-06-13T12:00:01Z"));

		immediateScheduler.enqueueBatch(events, 10);

		assertThat(taskScheduler.scheduledTasks).isEmpty();
		verify(broadcaster).broadcast(view("2", "2026-06-13T12:00:02Z"));
		verify(broadcaster).broadcast(view("1", "2026-06-13T12:00:01Z"));
	}

	private static EventView view(String id, String createdAt) {
		return new EventView(id, "PushEvent", createdAt, null, null, "summary", null, null, null, null);
	}

	private static GitHubEvent githubEvent(String id, String createdAt) {
		return new GitHubEvent(
				id,
				"PushEvent",
				new Actor(1L, "octocat", "https://avatars.example/octocat"),
				new RepoRef(2L, "octocat/Hello-World", "https://api.github.com/repos/octocat/Hello-World"),
				null,
				null,
				true,
				createdAt);
	}

	private static final class ScheduledTask {
		private final long delayMs;
		private final Runnable task;
		private final TrackedFuture future;

		private ScheduledTask(long delayMs, Runnable task, TrackedFuture future) {
			this.delayMs = delayMs;
			this.task = task;
			this.future = future;
		}

		private long delayMs() {
			return delayMs;
		}

		private void runIfActive() {
			if (!future.cancelled) {
				task.run();
			}
		}
	}

	private static final class TrackedFuture implements ScheduledFuture<Void> {
		private volatile boolean cancelled;

		@Override
		public boolean cancel(boolean mayInterruptIfRunning) {
			cancelled = true;
			return true;
		}

		@Override
		public boolean isCancelled() {
			return cancelled;
		}

		@Override
		public boolean isDone() {
			return cancelled;
		}

		@Override
		public Void get() {
			return null;
		}

		@Override
		public Void get(long timeout, java.util.concurrent.TimeUnit unit) {
			return null;
		}

		@Override
		public long getDelay(java.util.concurrent.TimeUnit unit) {
			return 0;
		}

		@Override
		public int compareTo(java.util.concurrent.Delayed other) {
			return 0;
		}
	}

	private static final class RecordingTaskScheduler implements TaskScheduler {

		private final List<ScheduledTask> scheduledTasks = new ArrayList<>();

		@Override
		public ScheduledFuture<?> schedule(Runnable task, Instant startTime) {
			long delayMs = Math.max(0, Duration.between(Instant.now(), startTime).toMillis());
			TrackedFuture future = new TrackedFuture();
			scheduledTasks.add(new ScheduledTask(delayMs, task, future));
			return future;
		}

		@Override
		public ScheduledFuture<?> schedule(Runnable task, Trigger trigger) {
			throw new UnsupportedOperationException();
		}

		@Override
		public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Duration period) {
			throw new UnsupportedOperationException();
		}

		@Override
		public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Duration delay) {
			throw new UnsupportedOperationException();
		}

		@Override
		public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Instant startTime, Duration period) {
			throw new UnsupportedOperationException();
		}

		@Override
		public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Instant startTime, Duration delay) {
			throw new UnsupportedOperationException();
		}

		private void runAllInOrder() {
			scheduledTasks.stream()
					.sorted(Comparator.comparingLong(ScheduledTask::delayMs))
					.forEach(ScheduledTask::runIfActive);
		}
	}
}
