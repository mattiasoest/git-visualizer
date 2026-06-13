package visualizer.github.api;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import visualizer.github.github.EventRingBuffer;
import visualizer.github.github.model.Actor;
import visualizer.github.github.model.GitHubEvent;
import visualizer.github.github.model.RepoRef;
import visualizer.github.stream.EventBroadcaster;

@WebMvcTest(StreamController.class)
class StreamControllerTest {

	@Autowired
	private MockMvc mockMvc;

	@MockitoBean
	private EventBroadcaster broadcaster;

	@MockitoBean
	private EventRingBuffer ringBuffer;

	@MockitoBean
	private EventMapper eventMapper;

	@Test
	void opensSseStreamWithReplay() throws Exception {
		GitHubEvent rawEvent = new GitHubEvent(
				"1",
				"PushEvent",
				new Actor(1L, "octocat", "https://avatars.example/octocat"),
				new RepoRef(2L, "octocat/Hello-World", "https://api.github.com/repos/octocat/Hello-World"),
				null,
				null,
				true,
				"2026-06-13T12:00:00Z");
		EventView view = new EventView(
				"1",
				"PushEvent",
				"2026-06-13T12:00:00Z",
				new ActorView("octocat", "https://avatars.example/octocat"),
				new RepoView("octocat/Hello-World"),
				"pushed to main",
				"refs/heads/main",
				null,
				null);

		SseEmitter emitter = new SseEmitter();
		when(broadcaster.subscribe()).thenReturn(emitter);
		when(ringBuffer.snapshot(anyInt())).thenReturn(List.of(rawEvent));
		when(eventMapper.toView(rawEvent)).thenReturn(view);

		mockMvc.perform(get("/api/stream/events?replay=10"))
				.andExpect(status().isOk())
				.andExpect(request().asyncStarted());

		verify(broadcaster).subscribe();
		verify(broadcaster).sendReplay(emitter, List.of(view));
	}
}
